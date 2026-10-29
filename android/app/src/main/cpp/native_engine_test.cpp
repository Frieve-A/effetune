#include "AutomationCatalog.h"
#include "native_engine.h"
#include "pcm_resampler.h"
#include "registry.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <thread>
#include <unistd.h>

using namespace effetune;
using namespace effetune::android;

namespace effetune::android {
struct NativeEngineTestAccess {
  static std::shared_ptr<OutputError> errorState(NativeEngine &engine) {
    return engine.outputError_;
  }
};
} // namespace effetune::android

namespace {
void check(bool condition, const char *message) {
  if (!condition)
    throw std::runtime_error(message);
}
void outputErrorTests() {
  NativeEngine engine(48000, 256);
  const auto generation = engine.beginSource();
  float queued[128]{};
  check(engine.writePcm(queued, 64, generation) == 64,
        "Queue before output error");
  check(engine.start() == 0, "Start output before disconnection");
  auto oldError = NativeEngineTestAccess::errorState(engine);
  oldError->onError(nullptr, oboe::Result::ErrorDisconnected);
  check(engine.outputStatus() ==
            static_cast<int>(oboe::Result::ErrorDisconnected),
        "Control observes disconnected output");
  check(engine.queuedFrames() == 64 && engine.renderedFrames() == 0,
        "Error preserves paused PCM and source clock");
  check(engine.start() == 0 && engine.outputStatus() == 1,
        "Play reopens failed output");
  oldError->onError(nullptr, oboe::Result::ErrorInternal);
  check(engine.outputStatus() == 1,
        "Retired stream error cannot poison replacement");
  engine.stop();
  oldError->onError(nullptr, oboe::Result::ErrorDisconnected);
  check(engine.outputStatus() == 0,
        "Deliberate stop is not an error or automatic restart");
}

std::vector<float> resampleFixture(int rate, int outputRate, int chunk,
                                   double frequency) {
  PcmResampler converter(rate, outputRate);
  std::vector<float> result;
  constexpr int frames = 9600;
  for (int offset = 0; offset < frames; offset += chunk) {
    const auto count = std::min(chunk, frames - offset);
    std::vector<float> input(static_cast<std::size_t>(count) * 2);
    for (int i = 0; i < count; ++i)
      input[i * 2] = static_cast<float>(
          std::sin((offset + i) * 6.283185307179586 * frequency / rate));
    auto output =
        converter.process(input.data(), count, offset + count == frames);
    result.insert(result.end(), output.begin(), output.end());
  }
  check(result.size() ==
            static_cast<std::size_t>((9600LL * outputRate + rate / 2) / rate) *
                2,
        "Resampler exact duration including drained filter");
  return result;
}

void resamplerTests() {
  const auto continuous = resampleFixture(44100, 48000, 1024, 1000);
  const auto fragmented = resampleFixture(44100, 48000, 73, 1000);
  check(continuous == fragmented,
        "Resampler phase is independent of decoder block sizes");
  double energy = 0;
  for (std::size_t i = 128; i + 128 < continuous.size(); i += 2) {
    energy += continuous[i] * continuous[i];
    check(continuous[i + 1] == 0, "Resampler preserves stereo isolation");
  }
  check(energy > 1000, "Resampler preserves in-band signal");
  const auto rejected = resampleFixture(96000, 48000, 331, 30000);
  double alias = 0;
  for (std::size_t i = 128; i + 128 < rejected.size(); i += 2)
    alias += rejected[i] * rejected[i];
  check(std::sqrt(alias / (rejected.size() / 2 - 128)) < 0.005,
        "Downsampling rejects ultrasonic aliases");
  resampleFixture(2000, 48000, 1024, 200);
  resampleFixture(1536000, 48000, 1024, 1000);
}
std::vector<std::uint8_t> descriptor(bool enabled = true, bool gate = true) {
  std::vector<std::uint8_t> result(20);
  result[0] = 1;
  result[4] = 1;
  result[8] = 1;
  result[12] = enabled;
  result[15] = 255;
  result[16] = gate;
  return result;
}
void ringTests() {
  PcmRing<4> ring;
  const float source[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
  auto generation = ring.beginSource();
  check(ring.write(source, 5, generation) == 4, "PCM queue must be bounded");
  float output[4]{};
  check(ring.read(output, 2, false) == 0 && ring.queued() == 4,
        "Pause must preserve PCM");
  check(ring.read(output, 2, true) == 2, "PCM frames read");
  check(output[0] == 1 && output[1] == 3 && output[2] == 2 && output[3] == 4,
        "Stereo layout");
  const auto stale = generation;
  generation = ring.beginSource();
  check(ring.write(source, 1, stale) == 0, "Reject stale producer");
  std::fill_n(output, 4, 0.0F);
  check(ring.read(output, 2, true) == 0 && ring.queued() == 0,
        "Discard seek generation");
  check(ring.write(source, 1, generation) == 1,
        "Source replacement accepts new PCM");
  check(ring.read(output, 2, true) == 1 && output[1] == 0 && output[3] == 0,
        "Underrun remains silent");
}
void pipelineTests() {
  NativeEngine native(8000, 64);
  const auto *volume = registry::find("VolumePlugin");
  check(volume != nullptr, "Volume registry");
  auto ids = native.configure({"VolumePlugin"}, {{0}}, {volume->paramsHash},
                              descriptor());
  const auto events = native.runtimeEvents();
  check(events.size() == 4 && events[0] == ids[0] && events[2] == 0,
        "Runtime event snapshot preserves native instance identity");
  const auto generation = native.beginSource();
  std::vector<float> samples(128, 0.25F), output(128);
  native.writePcm(samples.data(), 64, generation);
  native.onAudioReady(nullptr, output.data(), 64);
  check(native.queuedFrames() == 64 && native.renderedFrames() == 0,
        "Paused source stays queued");
  native.setPlaying(true);
  native.onAudioReady(nullptr, output.data(), 64);
  check(native.renderedFrames() == 64, "Source clock counts consumed frames");
  for (const auto sample : output)
    check(std::abs(sample - 0.25F) < 0.000001F, "Unity native parity");
  native.onAudioReady(nullptr, output.data(), 64);
  check(native.renderedFrames() == 64,
        "Underrun must not advance source clock");
  const auto eventFrame = native.audioFrameTime() + 32;
  check(native.scheduleParameters(ids[0], {-12}, volume->paramsHash,
                                  eventFrame) == 0,
        "Schedule event");
  native.writePcm(samples.data(), 64, generation);
  native.onAudioReady(nullptr, output.data(), 64);
  check(std::abs(output[62] - 0.25F) < 0.000001F && output[126] < output[62],
        "Sample-exact event boundary");
  bool rejected = false;
  try {
    native.configure({"MissingPlugin"}, {{}}, {0}, descriptor());
  } catch (const std::exception &) {
    rejected = true;
  }
  check(rejected, "Reject invalid topology without replacing graph");
  check(native.setParameters(ids[0], {0}, volume->paramsHash) == 0,
        "Old graph survives failed configure");
  native.configure({"MutePlugin"}, {{}},
                   {registry::find("MutePlugin")->paramsHash},
                   descriptor(true, false));
  native.writePcm(samples.data(), 64, generation);
  native.onAudioReady(nullptr, output.data(), 64);
  for (const auto sample : output)
    check(sample == 0.25F, "Section gate excludes effect");
  native.setPlaying(false);
  native.setPowerSettings(0.0001F, 3, false);
  for (int i = 0; i < 376; ++i)
    native.onAudioReady(nullptr, output.data(), 64);
  check(native.powerObservation()[4] == 1,
        "Common silence deadline enters monitoring");
  native.setPlaying(true);
  native.writePcm(samples.data(), 64, generation);
  native.onAudioReady(nullptr, output.data(), 64);
  check(native.powerObservation()[4] == 0, "Fresh input wakes monitoring");
  for (const auto sample : output)
    check(sample == 0.25F, "Monitoring wake preserves the first input block");
  native.setPowerSettings(0.0001F, 3, true);
  native.setPlaying(false);
  for (int i = 0; i < 376; ++i)
    native.onAudioReady(nullptr, output.data(), 64);
  check(native.powerObservation()[4] == 0,
        "Temporal requirement prevents demotion");
  rejected = false;
  try {
    native.beginMeasurementFiles(-1, -1, 64, 64);
  } catch (const std::exception &) {
    rejected = true;
  }
  check(rejected, "Finite capture requires an acquired microphone");
}
void playerGainTests() {
  PcmRing<4> ring;
  const float pcm[] = {0.4F, 0.8F};
  const auto generation = ring.beginSource();
  float mixed[] = {0.1F, 0.2F};
  ring.write(pcm, 1, generation);
  check(ring.read(mixed, 1, true, 0.5F) == 1, "Player gain consumes PCM");
  check(std::abs(mixed[0] - 0.3F) < 0.000001F &&
            std::abs(mixed[1] - 0.6F) < 0.000001F,
        "Player gain scales only PCM, preserving live input");
  ring.write(pcm, 1, generation);
  check(ring.read(mixed, 1, true, 0) == 1 && ring.queued() == 0,
        "Muted PCM still advances playback");
  check(std::abs(mixed[0] - 0.3F) < 0.000001F,
        "Player mute preserves live input");

  NativeEngine native(48000, 64);
  const auto *volume = registry::find("VolumePlugin");
  native.configure({"VolumePlugin"}, {{0}}, {volume->paramsHash}, descriptor());
  std::vector<float> source(128, 0.8F), output(128);
  const auto sourceGeneration = native.beginSource();
  native.setPlayerGain(0.25F);
  native.setPlaying(true);
  native.writePcm(source.data(), 64, sourceGeneration);
  native.onAudioReady(nullptr, output.data(), 64);
  check(std::abs(native.powerObservation()[1] - 0.2F) < 0.000001F,
        "Player gain is applied before DSP input activity");
  for (float sample : output)
    check(std::abs(sample - 0.2F) < 0.000001F,
          "Native player volume scales PCM");
  native.setPlayerGain(0);
  native.configure({"OscillatorPlugin"}, {{880, -12, 0, 0, 0, 500, 5}},
                   {registry::find("OscillatorPlugin")->paramsHash},
                   descriptor());
  native.onAudioReady(nullptr, output.data(), 64);
  float peak = 0;
  for (float sample : output)
    peak = std::max(peak, std::abs(sample));
  check(peak > 0.1F,
        "Player mute does not mute a source-generating DSP effect");
  native.setGain(0);
  native.onAudioReady(nullptr, output.data(), 64);
  for (float sample : output)
    check(sample == 0, "Output gain remains independent of player volume");
}
void registryTests() {
  check(registry::count() == 112, "All registered kernels linked");
  for (std::uint32_t index = 0; index < registry::count(); ++index) {
    const auto *type = registry::at(index);
    auto engine = std::make_unique<Engine>();
    check(engine->prepare(48000, 2, 64, 65536) == ET_OK,
          "Registry engine prepare");
    const auto instance = engine->createInstance(type->typeName);
    check(instance != 0, type->typeName);
    std::vector<float> parameters(type->paramsFloatCount);
    for (const auto &effect : generated::kAutomationEffects) {
      if (effect.type != type->typeName)
        continue;
      for (std::uint32_t p = 0; p < effect.parameterCount; ++p) {
        const auto &parameter =
            generated::kAutomationParameters[effect.firstParameter + p];
        if (parameter.packedOffset < parameters.size())
          parameters[parameter.packedOffset] = parameter.packedDefaultValue;
      }
    }
    check(engine->setInstanceParams(instance, parameters.data(),
                                    type->paramsFloatCount, type->paramsHash,
                                    0) == ET_OK,
          type->typeName);
    engine->setInstanceSeed(instance, 123, 456);
    float samples[128]{};
    samples[0] = 0.125F;
    check(engine->processInstance(instance, samples, 2, 64, 0) == ET_OK,
          type->typeName);
    for (const auto sample : samples)
      check(std::isfinite(sample), type->typeName);
  }
}
void captureTests() {
  check(sizeof(FiniteCapture) < 3 * 1024 * 1024,
        "Finite capture memory is bounded independently of duration");
  auto *excitationFile = std::tmpfile();
  auto *resultFile = std::tmpfile();
  check(excitationFile && resultFile, "Capture temporary files");
  std::vector<float> excitation(128, 0.125F), microphone(128, 0.25F),
      output(128);
  check(std::fwrite(excitation.data(), sizeof(float), excitation.size(),
                    excitationFile) == excitation.size(),
        "Excitation write");
  std::fflush(excitationFile);
  {
    NativeEngine engine(8000, 64);
    engine.configure({"MutePlugin"}, {{}},
                     {registry::find("MutePlugin")->paramsHash}, descriptor());
    engine.setMeasurementNoiseFile(fileno(excitationFile), 64);
    engine.onAudioReady(nullptr, output.data(), 64);
    for (float value : output)
      check(value == 0.125F, "Measurement noise bypasses DSP");
    check(engine.powerObservation()[1] == 0,
          "Measurement input peak observes microphone, not excitation");
    engine.stopMeasurementNoise();
    engine.onAudioReady(nullptr, output.data(), 64);
    for (float value : output)
      check(value == 0, "Noise stop restores ordinary processing");
  }
  {
    auto capture = std::make_unique<FiniteCapture>(fileno(excitationFile),
                                                   fileno(resultFile), 64, 64);
    const auto deadline =
        std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (capture->status() == 1 &&
           std::chrono::steady_clock::now() < deadline) {
      if (capture->frames() == 0)
        capture->process(microphone.data(), 64, output.data(), 64);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    check(capture->status() == 2 && capture->frames() == 64,
          "Finite capture completes only after file write");
    capture->invalidate();
    check(capture->status() == 2,
          "Input release preserves an already completed recording");
    float saved[128];
    check(pread(fileno(resultFile), saved, sizeof(saved), 0) == sizeof(saved),
          "Capture read");
    for (float value : saved)
      check(value == 0.25F, "Captured PCM matches input");
    for (float value : output)
      check(value == 0.125F, "Excitation output matches source");
  }
  {
    auto capture = std::make_unique<FiniteCapture>(fileno(excitationFile),
                                                   fileno(resultFile), 64, 128);
    for (int i = 0; i < 500 && capture->frames() == 0; ++i) {
      capture->process(microphone.data(), 64, output.data(), 64);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    check(capture->frames() == 64, "Capture begins");
    capture->process(microphone.data(), 0, output.data(), 64);
    check(capture->status() == 3,
          "Input underrun invalidates finite recording");
  }
  constexpr std::uint32_t longest = 16u * 1048576u + 41u * 48000u;
  {
    auto capture = std::make_unique<FiniteCapture>(
        fileno(excitationFile), fileno(resultFile), 64, 65537);
    std::vector<float> largeInput(65537 * 2, 0.25F), largeOutput(65537 * 2);
    for (int i = 0; i < 500 && capture->status() == 1; ++i) {
      capture->process(largeInput.data(), 65537, largeOutput.data(), 65537);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    check(capture->status() == 3,
          "Capture transport overflow invalidates recording");
  }
  check(ftruncate(fileno(excitationFile), static_cast<off_t>(longest) * 8) == 0,
        "Sparse long excitation");
  {
    auto capture = std::make_unique<FiniteCapture>(
        fileno(excitationFile), fileno(resultFile), longest, longest);
    capture->invalidate();
    check(capture->status() == 3,
          "Long recording cancellation invalidates result and joins worker");
  }
  std::fclose(excitationFile);
  std::fclose(resultFile);
}

void assetTests() {
  NativeEngine native(48000, 64);
  const auto *type = registry::find("IRReverbPlugin");
  const auto ids = native.configure({"IRReverbPlugin"}, {{0, 0, 1, 0, 0, 0, 0}},
                                    {type->paramsHash}, descriptor());
  const std::uint32_t words[]{0x31415445, 1, 1, 48000, 1, 0, 0, 0, 0x3f800000};
  std::vector<std::uint8_t> payload(sizeof(words));
  std::memcpy(payload.data(), words, sizeof(words));
  const AssetBeginInfo info{
      1, 1, 1, 0, 1, 0, 0, 2, 32 * 1024 * 1024, sizeof(words)};
  auto *file = std::tmpfile();
  check(file && std::fwrite(payload.data(), 1, payload.size(), file) ==
                    payload.size(),
        "IR file fixture");
  std::fflush(file);
  const auto assetStatus = native.setAssetFile(
      ids[0], 0, info, fileno(file), payload.size(), ET_ASSET_F32_MULTICH);
  if (assetStatus != ET_OK)
    std::fprintf(stderr, "IR asset status=%d\n", assetStatus);
  check(assetStatus == ET_OK,
        "File-backed IR prepares and publishes latency off callback");
  std::fclose(file);
  auto generation = native.beginSource();
  native.setPlaying(true);
  float input[128]{}, output[128]{};
  // Allow the core's incremental preparation and wet fade-in to complete.
  for (int block = 0; block < 16; ++block)
    native.onAudioReady(nullptr, output, 64);
  input[0] = input[1] = 0.25F;
  native.writePcm(input, 64, generation);
  native.onAudioReady(nullptr, output, 64);
  check(std::abs(output[0] - 0.25F) < 0.00001F &&
            std::abs(output[1] - 0.25F) < 0.00001F,
        "Unity synthetic IR preserves stereo impulse");
  payload[0] = 0;
  check(native.setAsset(ids[0], 0, info, payload, ET_ASSET_F32_MULTICH) !=
            ET_OK,
        "Malformed asset rejected");
  check(native.setAsset(ids[0], 0, {}, {}, 0) == ET_OK,
        "Clear prepared IR asset");
}

void temporalTests() {
  NativeEngine native(8000, 64);
  const std::vector<std::pair<std::string, std::vector<float>>> effects{
      {"DelayPlugin", {0, 150, 50, 3000, 100, 50, 50, 0}},
      {"FDNReverbPlugin",
       {0.2F, 4, 0, 20, 5, 6, 100, 0, 0.3F, 100, 30, 100, 100}}};
  float input[128]{}, output[128]{};
  input[0] = input[1] = 0.25F;
  for (const auto &[type, parameters] : effects) {
    native.configure({type}, {parameters},
                     {registry::find(type.c_str())->paramsHash}, descriptor());
    native.setPowerSettings(0.0001F, 3, false);
    native.setPlaying(true);
    const auto generation = native.beginSource();
    native.writePcm(input, 64, generation);
    native.onAudioReady(nullptr, output, 64);
    bool heardTail = false;
    for (int block = 0; block < 1000; ++block) {
      native.onAudioReady(nullptr, output, 64);
      const auto observation = native.powerObservation();
      if (observation[2] > 0.0001F) {
        heardTail = true;
        check(observation[4] == 0,
              "Stateful tail must finish before monitoring");
      }
    }
    check(heardTail && native.powerObservation()[4] == 1,
          "Silent stateful effect enters normal monitoring");
    native.stop();
    native.writePcm(input, 64, generation);
    native.prepareResume();
    check(native.queuedFrames() == 64,
          "Canonical idle resume preserves queued source frames");
    native.onAudioReady(nullptr, output, 64);
    check(native.powerObservation()[4] == 0 &&
              native.powerObservation()[1] == 0.25F,
          "Canonical idle resume processes fresh input");
  }
  native.configure({"OscillatorPlugin"}, {{880, -12, 0, 0, 0, 500, 5}},
                   {registry::find("OscillatorPlugin")->paramsHash},
                   descriptor());
  native.setPowerSettings(0.0001F, 3, true);
  native.setPlaying(false);
  for (int block = 0; block < 500; ++block)
    native.onAudioReady(nullptr, output, 64);
  check(native.powerObservation()[4] == 0 &&
            native.powerObservation()[2] > 0.01F,
        "Generator remains processing without live input");
}
} // namespace

int main() {
  try {
    check(inputBurstFrames(240, 16000, 48000) == 720,
          "Converted input burst uses host frame units");
    check(inputBurstFrames(240, 44100, 48000) == 262,
          "Fractional input burst rounds upward");
    ringTests();
    outputErrorTests();
    resamplerTests();
    captureTests();
    assetTests();
    temporalTests();
    pipelineTests();
    playerGainTests();
    registryTests();
    std::puts("Android runtime: bounded PCM, generation, clock, Section, timed "
              "params, power, "
              "stream recovery, resampling and 112 kernels passed.");
    return 0;
  } catch (const std::exception &error) {
    std::fprintf(stderr, "Android runtime test failed: %s\n", error.what());
    return 1;
  }
}

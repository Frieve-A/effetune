#include "native_engine.h"
#include <cmath>
#include <jni.h>
#include <stdexcept>

using effetune::android::NativeEngine;

namespace {
NativeEngine &engine(jlong handle) {
  if (handle == 0)
    throw std::invalid_argument("Engine is closed");
  return *reinterpret_cast<NativeEngine *>(handle);
}
template <typename Result, typename Function>
Result checked(JNIEnv *env, Result fallback, Function function) {
  try {
    return function();
  } catch (const std::exception &error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                  error.what());
    return fallback;
  }
}
std::vector<std::uint8_t> bytes(JNIEnv *env, jbyteArray input) {
  if (!input)
    throw std::invalid_argument("Missing bytes");
  const auto size = env->GetArrayLength(input);
  if (size > 256 * 1024 * 1024)
    throw std::invalid_argument("Asset too large");
  std::vector<std::uint8_t> result(size);
  env->GetByteArrayRegion(input, 0, size,
                          reinterpret_cast<jbyte *>(result.data()));
  return result;
}
std::vector<float> floatPrefix(JNIEnv *env, jfloatArray input, jsize size) {
  std::vector<float> result(size);
  if (size)
    env->GetFloatArrayRegion(input, 0, size, result.data());
  for (const auto value : result)
    if (!std::isfinite(value))
      throw std::invalid_argument("Nonfinite audio data");
  return result;
}
std::vector<float> floats(JNIEnv *env, jfloatArray input) {
  if (!input)
    throw std::invalid_argument("Missing parameters");
  const auto size = env->GetArrayLength(input);
  if (size > 131072)
    throw std::invalid_argument("Too many samples");
  return floatPrefix(env, input, size);
}
jlongArray longs(JNIEnv *env, const std::vector<std::int64_t> &values) {
  const auto size = static_cast<jsize>(values.size());
  auto array = env->NewLongArray(size);
  if (array && size)
    env->SetLongArrayRegion(array, 0, size, values.data());
  return array;
}
jbyteArray byteArray(JNIEnv *env, const std::vector<std::uint8_t> &values) {
  const auto size = static_cast<jsize>(values.size());
  auto array = env->NewByteArray(size);
  if (array && size)
    env->SetByteArrayRegion(array, 0, size, reinterpret_cast<const jbyte *>(values.data()));
  return array;
}
} // namespace

#define JNI_METHOD(name) Java_com_frieve_effetune_NativeEngine_##name
extern "C" {
JNIEXPORT jlong JNICALL JNI_METHOD(create)(
    JNIEnv *env, jclass, jint rate, jint frames, jint channels) {
  return checked(env, jlong{0}, [&] {
    return reinterpret_cast<jlong>(new NativeEngine(rate, frames, channels));
  });
}
JNIEXPORT jlongArray JNICALL JNI_METHOD(runBenchmark)(
    JNIEnv *env, jclass, jlong handle, jbyteArray input, jint channels,
    jint warmupBlocks, jlong durationNs) {
  return checked(env, static_cast<jlongArray>(nullptr), [&] {
    const auto byteCount = input ? env->GetArrayLength(input) : 0;
    if (byteCount <= 0 || byteCount % sizeof(float) || warmupBlocks < 0 ||
        durationNs < 0)
      throw std::invalid_argument("Invalid benchmark workload");
    std::vector<float> planarLoop(byteCount / sizeof(float));
    env->GetByteArrayRegion(input, 0, byteCount,
                            reinterpret_cast<jbyte *>(planarLoop.data()));
    const auto timing = engine(handle).benchmark(planarLoop, channels, warmupBlocks, durationNs);
    const jlong values[]{static_cast<jlong>(timing[0]), static_cast<jlong>(timing[1])};
    auto result = env->NewLongArray(2);
    if (result)
      env->SetLongArrayRegion(result, 0, 2, values);
    return result;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(destroy)(JNIEnv *, jclass, jlong handle) {
  delete reinterpret_cast<NativeEngine *>(handle);
}
JNIEXPORT jint JNICALL JNI_METHOD(start)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{-1}, [&] { return engine(handle).start(); });
}
JNIEXPORT jboolean JNICALL JNI_METHOD(checkOutputFormat)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jboolean{false}, [&] { return engine(handle).checkOutputFormat(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(outputStatus)(JNIEnv *env, jclass,
                                                jlong handle) {
  return checked(env, jint{-1}, [&] { return engine(handle).outputStatus(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(inputSessionId)(JNIEnv *env, jclass,
                                                  jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).inputSessionId(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(networkOutput)(JNIEnv *env, jclass, jlong handle,
                                                  jboolean attached, jboolean paused) {
  return checked(env, jint{-1}, [&] { return engine(handle).setNetworkOutput(attached, paused); });
}
JNIEXPORT jint JNICALL JNI_METHOD(networkLocalDelay)(JNIEnv *env, jclass, jlong handle, jint request,
                                                     jboolean active, jdouble ms, jboolean local) {
  return checked(env, jint{-1}, [&] { return engine(handle).setNetworkLocalDelay(request, active, ms, local); });
}
JNIEXPORT jint JNICALL JNI_METHOD(networkReceive)(JNIEnv *env, jclass, jlong handle, jboolean active,
                                                  jlong generation) {
  return checked(env, jint{-1}, [&] { return engine(handle).setNetworkReceiveSession(active, generation); });
}
JNIEXPORT void JNICALL JNI_METHOD(liveInput)(JNIEnv *env, jclass, jlong handle, jboolean enabled) {
  checked(env, false, [&] { engine(handle).setLiveInput(enabled); return true; });
}
JNIEXPORT void JNICALL JNI_METHOD(liveActivate)(JNIEnv *env, jclass, jlong handle, jlong generation) {
  checked(env, false, [&] { engine(handle).activateLiveInput(generation); return true; });
}
JNIEXPORT jint JNICALL JNI_METHOD(liveWrite)(JNIEnv *env, jclass, jlong handle, jfloatArray pcm, jint frames) {
  return checked(env, jint{0}, [&]() -> jint {
    if (!pcm || frames < 1 || frames > 4096 || env->GetArrayLength(pcm) < frames * 2)
      throw std::invalid_argument("Invalid live PCM frame count");
    auto &owner = engine(handle);
    auto *data = env->GetFloatArrayElements(pcm, nullptr);
    if (!data) return 0;
    const auto accepted = owner.writeLivePcm(data, frames);
    env->ReleaseFloatArrayElements(pcm, data, JNI_ABORT);
    return accepted;
  });
}
JNIEXPORT jdouble JNICALL JNI_METHOD(livePosition)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jdouble{-1}, [&] { return engine(handle).livePosition(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(networkAck)(JNIEnv *env, jclass, jlong handle, jlong epoch, jlong frame) {
  return checked(env, jint{-1}, [&] { return engine(handle).acknowledgeNetwork(epoch, frame); });
}
JNIEXPORT jboolean JNICALL JNI_METHOD(networkPacket)(JNIEnv *env, jclass, jlong handle, jshortArray pcm,
                                                     jlongArray indices, jdoubleArray timing) {
  return checked(env, jboolean{JNI_FALSE}, [&]() -> jboolean {
    effetune::audio::NetworkPacket p;
    if (env->GetArrayLength(pcm) != static_cast<jsize>(p.pcm.size()) ||
        env->GetArrayLength(indices) != 4 || env->GetArrayLength(timing) != 4)
      throw std::invalid_argument("Invalid network packet buffers");
    if (!engine(handle).popNetworkPacket(p)) return JNI_FALSE;
    const jlong positions[] = {static_cast<jlong>(p.sourceEpoch), static_cast<jlong>(p.sourceFrame),
                               static_cast<jlong>(p.routeRevision), static_cast<jlong>(p.routeRevisionEnd)};
    const jdouble clock[] = {p.contextFrame, p.contextFrameStep, double(p.contextSampleRate),
                             double(engine(handle).networkFrame())};
    env->SetShortArrayRegion(pcm, 0, p.pcm.size(), p.pcm.data());
    env->SetLongArrayRegion(indices, 0, 4, positions);
    env->SetDoubleArrayRegion(timing, 0, 4, clock);
    return JNI_TRUE;
  });
}
JNIEXPORT jstring JNICALL JNI_METHOD(networkReports)(JNIEnv *env, jclass, jlong handle, jboolean force) {
  return checked(env, static_cast<jstring>(nullptr), [&] {
    const auto reports = engine(handle).networkReports(force);
    return reports.empty() ? nullptr : env->NewStringUTF(reports.c_str());
  });
}
JNIEXPORT void JNICALL JNI_METHOD(stop)(JNIEnv *env, jclass, jlong handle) {
  checked(env, 0, [&] {
    engine(handle).stop();
    return 0;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(sampleRate)(JNIEnv *env, jclass,
                                              jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).sampleRate(); });
}
JNIEXPORT void JNICALL JNI_METHOD(prepareResume)(JNIEnv *env, jclass,
                                                 jlong handle) {
  checked(env, 0, [&] {
    engine(handle).prepareResume();
    return 0;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(outputDeviceId)(JNIEnv *env, jclass,
                                                  jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).outputDeviceId(); });
}
JNIEXPORT jintArray JNICALL JNI_METHOD(runtimeEvents)(JNIEnv *env, jclass,
                                                      jlong handle) {
  return checked(env, static_cast<jintArray>(nullptr), [&] {
    const auto events = engine(handle).runtimeEvents();
    auto result = env->NewIntArray(static_cast<jsize>(events.size()));
    if (result)
      env->SetIntArrayRegion(result, 0, static_cast<jsize>(events.size()),
                             events.data());
    return result;
  });
}
JNIEXPORT jdoubleArray JNICALL JNI_METHOD(branchStats)(JNIEnv *env, jclass,
                                                       jlong handle, jint branch) {
  return checked(env, static_cast<jdoubleArray>(nullptr), [&] {
    const auto stats = engine(handle).pipelineStats(branch);
    auto result = env->NewDoubleArray(static_cast<jsize>(stats.size()));
    if (result)
      env->SetDoubleArrayRegion(result, 0, static_cast<jsize>(stats.size()), stats.data());
    return result;
  });
}
JNIEXPORT jdoubleArray JNICALL JNI_METHOD(pipelineStats)(JNIEnv *env, jclass cls, jlong handle) {
  return JNI_METHOD(branchStats)(env, cls, handle, 0);
}
JNIEXPORT jint JNICALL JNI_METHOD(startParallel)(JNIEnv *env, jclass, jlong handle, jint scoreFd, jdouble speed) {
  return checked(env, jint{-1}, [&] { return engine(handle).startParallel(scoreFd, speed); });
}
JNIEXPORT void JNICALL JNI_METHOD(stopParallel)(JNIEnv *env, jclass, jlong handle) {
  checked(env, 0, [&] { engine(handle).stopParallel(); return 0; });
}
JNIEXPORT jint JNICALL JNI_METHOD(selectParallel)(JNIEnv *env, jclass, jlong handle,
                                                  jint branch, jdouble seconds) {
  return checked(env, jint{-1}, [&] { return engine(handle).selectParallel(branch, seconds); });
}
JNIEXPORT jint JNICALL JNI_METHOD(outputDelay)(JNIEnv *env, jclass, jlong handle,
                                               jint branch, jint samples) {
  return checked(env, jint{-1}, [&] { return engine(handle).setOutputDelay(branch, samples); });
}
JNIEXPORT jint JNICALL JNI_METHOD(fadeOutput)(JNIEnv *env, jclass, jlong handle,
                                              jint branch, jfloat gain, jdouble seconds) {
  return checked(env, jint{-1}, [&] { return engine(handle).fadeOutput(branch, gain, seconds); });
}
JNIEXPORT jint JNICALL JNI_METHOD(takeOverload)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{-1}, [&] { return engine(handle).takeOverload(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(displayBypass)(JNIEnv *env, jclass, jlong handle,
                                                 jboolean bypass) {
  return checked(env, jint{-1},
                 [&] { return engine(handle).setDisplayBypass(bypass == JNI_TRUE); });
}
JNIEXPORT void JNICALL JNI_METHOD(frequencyPreview)(JNIEnv *env, jclass, jlong handle,
                                                     jdouble frequency, jboolean noise) {
  checked(env, 0, [&] {
    engine(handle).setFrequencyPreview(frequency, noise == JNI_TRUE);
    return 0;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(resetPlugin)(JNIEnv *env, jclass, jlong handle,
                                               jint instance) {
  return checked(env, jint{-1}, [&] { return engine(handle).resetPlugin(instance); });
}
JNIEXPORT jlong JNICALL JNI_METHOD(soundFontMixerAction)(JNIEnv *env, jclass, jlong handle,
                                                        jint instance, jint channel, jint mix,
                                                        jintArray messageArray) {
  return checked(env, jlong{-1}, [&] {
    const auto count = messageArray ? env->GetArrayLength(messageArray) : 0;
    if (count > 3)
      throw std::invalid_argument("Too many mixer messages");
    std::vector<std::uint32_t> messages(count);
    if (count)
      env->GetIntArrayRegion(messageArray, 0, count, reinterpret_cast<jint *>(messages.data()));
    return static_cast<jlong>(
        engine(handle).soundFontMixerAction(instance, channel, mix, messages));
  });
}
JNIEXPORT jdoubleArray JNICALL JNI_METHOD(sfzPreparationContext)(JNIEnv *env, jclass, jlong handle,
                                                                 jint instance, jint branch) {
  return checked(env, static_cast<jdoubleArray>(nullptr), [&] {
    const auto context = engine(handle).sfzPreparationContext(instance, branch);
    const auto size = static_cast<jsize>(context.size());
    auto result = env->NewDoubleArray(size);
    if (result && size)
      env->SetDoubleArrayRegion(result, 0, size, context.data());
    return result;
  });
}
JNIEXPORT jdouble JNICALL JNI_METHOD(scoreTransport)(JNIEnv *env, jclass, jlong handle,
    jint fd, jdouble position, jdouble speed, jboolean play) {
  return checked(env, -1.0, [&] { return engine(handle).scoreTransport(fd, position, speed, play); });
}
JNIEXPORT jdouble JNICALL JNI_METHOD(scorePosition)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, 0.0, [&] { return engine(handle).scorePosition(); });
}
JNIEXPORT jdouble JNICALL JNI_METHOD(pauseScore)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, 0.0, [&] { return engine(handle).pauseScore(); });
}
JNIEXPORT void JNICALL JNI_METHOD(scoreSpeed)(JNIEnv *env, jclass, jlong handle, jdouble speed) {
  checked(env, 0, [&] { engine(handle).scoreSpeed(speed); return 0; });
}
JNIEXPORT jboolean JNICALL JNI_METHOD(takeScoreEnded)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, false, [&] { return engine(handle).takeScoreEnded(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(liveMidiSource)(JNIEnv *env, jclass, jlong handle, jboolean enabled) {
  return checked(env, -1, [&] { return engine(handle).liveMidiSource(enabled); });
}
JNIEXPORT jint JNICALL JNI_METHOD(liveMidiEvent)(JNIEnv *env, jclass, jlong handle,
    jint message, jint note, jint flags, jintArray state, jdouble delay) {
  return checked(env, -1, [&] {
    const auto size = state ? env->GetArrayLength(state) : 0;
    if (size % 3 || size > 8192 * 3 || !(delay >= 0 && delay <= 0.1)) return -1;
    std::vector<jint> words(size);
    if (size) env->GetIntArrayRegion(state, 0, size, words.data());
    std::optional<std::vector<et_midi_event>> history;
    if (state) {
      history.emplace().reserve(size / 3);
      for (int i = 0; i < size; i += 3)
        history->push_back({0, static_cast<unsigned>(words[i]), static_cast<unsigned>(words[i + 1]),
                            static_cast<unsigned>(words[i + 2]), 0, 0});
    }
    return engine(handle).liveMidiEvent(message, note, flags, std::move(history), delay);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(setMidiMetering)(JNIEnv *env, jclass, jlong handle,
                                                    jint instance, jboolean enabled, jint branch) {
  return checked(env, jint{-1}, [&] { return engine(handle).setMidiMetering(instance, enabled, branch); });
}
JNIEXPORT jlongArray JNICALL JNI_METHOD(sampleStreams)(JNIEnv *env, jclass, jlong handle, jint branch) {
  return checked(env, static_cast<jlongArray>(nullptr),
                 [&] { return longs(env, engine(handle).sampleStreams(branch)); });
}
JNIEXPORT jlongArray JNICALL JNI_METHOD(pollSamplePages)(JNIEnv *env, jclass, jlong handle,
                                                         jint instance, jlong generation, jlong token, jint branch) {
  return checked(env, static_cast<jlongArray>(nullptr), [&] {
    return longs(env, engine(handle).pollSamplePages(instance, generation, token, branch));
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(publishSamplePage)(JNIEnv *env, jclass, jlong handle, jint instance,
                                                     jlong generation, jlong token, jint sample, jlong page,
                                                     jfloatArray pcm, jint frames, jint channels, jboolean resident, jint branch) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).publishSamplePage(instance, generation, token, sample, page, floats(env, pcm),
                                            frames, channels, resident, branch);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(failSampleStream)(JNIEnv *env, jclass, jlong handle, jint instance,
                                                    jlong generation, jlong token, jint branch) {
  return checked(env, jint{-1}, [&] { return engine(handle).failSampleStream(instance, generation, token, branch); });
}
JNIEXPORT jint JNICALL JNI_METHOD(assetState)(JNIEnv *env, jclass, jlong handle, jint instance, jint slot, jint branch) {
  return checked(env, jint{-1}, [&] { return engine(handle).assetState(instance, slot, branch); });
}
JNIEXPORT jintArray JNICALL JNI_METHOD(assetNotices)(JNIEnv *env, jclass, jlong handle, jint branch) {
  return checked(env, static_cast<jintArray>(nullptr), [&] {
    const auto notices = engine(handle).assetNotices(branch);
    auto result = env->NewIntArray(static_cast<jsize>(notices.size()));
    if (result)
      env->SetIntArrayRegion(result, 0, static_cast<jsize>(notices.size()), notices.data());
    return result;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(inputDevice)(JNIEnv *env, jclass,
                                               jlong handle, jint id) {
  return checked(env, jint{-1},
                 [&] { return engine(handle).setInputDevice(id); });
}
JNIEXPORT jint JNICALL JNI_METHOD(outputDevice)(JNIEnv *env, jclass,
                                                jlong handle, jint id) {
  return checked(env, jint{-1},
                 [&] { return engine(handle).setOutputDevice(id); });
}
JNIEXPORT jint JNICALL JNI_METHOD(latency)(JNIEnv *env, jclass, jlong handle,
                                           jint mode) {
  return checked(env, jint{-1},
                 [&] { return engine(handle).setLatency(mode); });
}
JNIEXPORT jint JNICALL JNI_METHOD(output)(JNIEnv *env, jclass, jlong handle,
                                          jint id, jint mode) {
  return checked(env, jint{-1},
                 [&] { return engine(handle).setOutput(id, mode); });
}
JNIEXPORT jintArray JNICALL JNI_METHOD(observeOutput)(JNIEnv *env, jclass,
                                                      jlong handle) {
  return checked(env, static_cast<jintArray>(nullptr), [&] {
    const auto stats = engine(handle).observeOutput();
    auto result = env->NewIntArray(static_cast<jsize>(stats.size()));
    if (result)
      env->SetIntArrayRegion(result, 0, static_cast<jsize>(stats.size()), stats.data());
    return result;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(measurementNoiseFile)(JNIEnv *env, jclass,
                                                        jlong handle, jint fd,
                                                        jint frames) {
  checked(env, 0, [&] {
    engine(handle).setMeasurementNoiseFile(fd, frames);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(stopMeasurementNoise)(JNIEnv *env, jclass,
                                                        jlong handle) {
  checked(env, 0, [&] {
    engine(handle).stopMeasurementNoise();
    return 0;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(measurementStreams)(JNIEnv *env, jclass, jlong handle, jint rate, jint device, jint output, jint width, jboolean restart) {
  return checked(env, jint{-1}, [&] {
    return rate ? engine(handle).openMeasurementStreams(rate, device, output, width) : engine(handle).closeMeasurementStreams(restart);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(measurementRate)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).measurementRate(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(measurementChannels)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).measurementChannels(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(measurementInputDevice)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).measurementInputDevice(); });
}
JNIEXPORT void JNICALL JNI_METHOD(duplexCapture)(JNIEnv *env, jclass, jlong handle, jint excitationFd,
    jint resultFd, jint excitationFrames, jint frames, jfloat overloadPeak, jint overloadTail, jint channel) {
  checked(env, 0, [&] {
    engine(handle).startDuplexCapture(excitationFd, resultFd, excitationFrames, frames, overloadPeak, overloadTail, channel);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(measurementPipeline)(JNIEnv *env, jclass, jlong handle, jboolean enabled) {
  checked(env, 0, [&] {
    engine(handle).setMeasurementPipeline(enabled);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(measurementMeter)(JNIEnv *env, jclass,
                                                    jlong handle, jint channel) {
  checked(env, 0, [&] {
    engine(handle).setMeasurementMeter(channel);
    return 0;
  });
}
JNIEXPORT jintArray JNICALL
JNI_METHOD(configureBranch)(JNIEnv *env, jclass, jlong handle, jobjectArray names,
                      jobjectArray parameterArrays, jintArray hashArray,
                      jintArray pluginIds, jbyteArray descriptor, jobjectArray structuredArrays,
                      jbyteArray flagArray, jint branch) {
  return checked(env, static_cast<jintArray>(nullptr), [&] {
    if (!names || !parameterArrays || !hashArray || !pluginIds)
      throw std::invalid_argument("Missing pipeline");
    const auto count = env->GetArrayLength(names);
    if (count > 128 || env->GetArrayLength(parameterArrays) != count ||
        env->GetArrayLength(hashArray) != count || env->GetArrayLength(pluginIds) != count)
      throw std::invalid_argument("Invalid pipeline count");
    std::vector<std::string> types;
    std::vector<std::vector<float>> parameters;
    std::vector<std::vector<std::uint8_t>> structured;
    if (!structuredArrays || env->GetArrayLength(structuredArrays) != count)
      throw std::invalid_argument("Invalid structured parameter count");
    if (!flagArray || env->GetArrayLength(flagArray) != count)
      throw std::invalid_argument("Invalid effect flag count");
    std::vector<std::uint32_t> hashes(count), ids(count);
    env->GetIntArrayRegion(hashArray, 0, count,
                           reinterpret_cast<jint *>(hashes.data()));
    env->GetIntArrayRegion(pluginIds, 0, count, reinterpret_cast<jint *>(ids.data()));
    for (int i = 0; i < count; ++i) {
      auto name = static_cast<jstring>(env->GetObjectArrayElement(names, i));
      if (!name || env->GetStringUTFLength(name) > 128)
        throw std::invalid_argument("Invalid effect type");
      const auto *text = env->GetStringUTFChars(name, nullptr);
      if (!text)
        throw std::runtime_error("Effect type allocation failed");
      types.emplace_back(text);
      env->ReleaseStringUTFChars(name, text);
      env->DeleteLocalRef(name);
      auto values = static_cast<jfloatArray>(
          env->GetObjectArrayElement(parameterArrays, i));
      parameters.push_back(floats(env, values));
      env->DeleteLocalRef(values);
      auto packed = static_cast<jbyteArray>(
          env->GetObjectArrayElement(structuredArrays, i));
      structured.push_back(bytes(env, packed));
      env->DeleteLocalRef(packed);
    }
    const auto result = engine(handle).configure(
        types, parameters, hashes, ids, bytes(env, descriptor), structured,
        bytes(env, flagArray), branch);
    auto output = env->NewIntArray(static_cast<jsize>(result.size()));
    if (output)
      env->SetIntArrayRegion(output, 0, static_cast<jsize>(result.size()),
                             result.data());
    return output;
  });
}
JNIEXPORT jintArray JNICALL JNI_METHOD(configure)(JNIEnv *env, jclass cls, jlong handle,
    jobjectArray names, jobjectArray parameters, jintArray hashes, jintArray ids,
    jbyteArray descriptor, jobjectArray structured, jbyteArray flags) {
  return JNI_METHOD(configureBranch)(env, cls, handle, names, parameters, hashes, ids,
                                     descriptor, structured, flags, 0);
}
JNIEXPORT jint JNICALL JNI_METHOD(branchParameters)(JNIEnv *env, jclass, jlong handle,
    jint instance, jfloatArray values, jint hash, jint branch) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).setParameters(instance, floats(env, values), hash, branch);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(branchParameterBytes)(JNIEnv *env, jclass, jlong handle,
    jint instance, jbyteArray values, jint hash, jint branch) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).setParameterBytes(instance, bytes(env, values), hash, branch);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(parameters)(JNIEnv *env, jclass, jlong handle,
                                              jint instance, jfloatArray values,
                                              jint hash) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).setParameters(instance, floats(env, values), hash);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(parameterBytes)(JNIEnv *env, jclass,
                                                  jlong handle, jint instance,
                                                  jbyteArray values,
                                                  jint hash) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).setParameterBytes(instance, bytes(env, values), hash);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(asset)(JNIEnv *env, jclass, jlong handle,
                                         jint instance, jint slot,
                                         jintArray metadata, jbyteArray data,
                                         jint format, jlong revision, jint branch) {
  return checked(env, jint{-1}, [&] {
    if (!metadata || env->GetArrayLength(metadata) != 10 || revision < -1 || revision > UINT32_MAX)
      throw std::invalid_argument("Invalid asset metadata");
    effetune::AssetBeginInfo info{};
    static_assert(sizeof(info) == 10 * sizeof(jint));
    env->GetIntArrayRegion(metadata, 0, 10, reinterpret_cast<jint *>(&info));
    return engine(handle).setAsset(instance, slot, info, bytes(env, data),
                                   format, revision < 0 ? std::nullopt :
                                       std::optional(static_cast<std::uint32_t>(revision)), branch);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(visualizerSources)(JNIEnv *env, jclass, jlong handle,
                                                     jobjectArray typeArray,
                                                     jobjectArray parameterArrays,
                                                     jintArray tapArray, jintArray hashArray,
                                                     jintArray channelArray,
                                                     jfloatArray gainArray) {
  return checked(env, jint{-1}, [&] {
    if (!typeArray || !parameterArrays || !tapArray || !hashArray || !channelArray ||
        !gainArray)
      throw std::invalid_argument("Missing visualizer sources");
    const auto count = env->GetArrayLength(typeArray);
    if (count > 128 || env->GetArrayLength(parameterArrays) != count ||
        env->GetArrayLength(tapArray) != count || env->GetArrayLength(hashArray) != count ||
        env->GetArrayLength(channelArray) != count * 2 ||
        env->GetArrayLength(gainArray) != count)
      throw std::invalid_argument("Invalid visualizer source count");
    std::vector<std::uint32_t> taps(count), hashes(count), channels(count * 2);
    env->GetIntArrayRegion(tapArray, 0, count, reinterpret_cast<jint *>(taps.data()));
    env->GetIntArrayRegion(hashArray, 0, count, reinterpret_cast<jint *>(hashes.data()));
    env->GetIntArrayRegion(channelArray, 0, count * 2,
                           reinterpret_cast<jint *>(channels.data()));
    const auto gains = floats(env, gainArray);
    std::vector<effetune::audio::VisualizerSource> sources(count);
    for (int i = 0; i < count; ++i) {
      auto &source = sources[i];
      auto type = static_cast<jstring>(env->GetObjectArrayElement(typeArray, i));
      if (!type || env->GetStringUTFLength(type) > 128)
        throw std::invalid_argument("Invalid visualizer type");
      const auto *text = env->GetStringUTFChars(type, nullptr);
      if (!text)
        throw std::runtime_error("Visualizer type allocation failed");
      source.type = text;
      env->ReleaseStringUTFChars(type, text);
      env->DeleteLocalRef(type);
      auto values = static_cast<jfloatArray>(env->GetObjectArrayElement(parameterArrays, i));
      source.params = floats(env, values);
      env->DeleteLocalRef(values);
      source.tap = taps[i];
      source.hash = hashes[i];
      source.left = channels[i * 2];
      source.right = channels[i * 2 + 1];
      source.gain = gains[i];
    }
    return engine(handle).setVisualizerSources(std::move(sources));
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(assetFile)(JNIEnv *env, jclass, jlong handle,
                                             jint instance, jint slot,
                                             jintArray metadata, jint fd,
                                             jlong byteSize, jint format, jlong revision, jint branch) {
  return checked(env, jint{-1}, [&] {
    if (!metadata || env->GetArrayLength(metadata) != 10 || byteSize <= 0 ||
        byteSize > 1024LL * 1024 * 1024 || revision < -1 || revision > UINT32_MAX)
      throw std::invalid_argument("Invalid asset metadata");
    effetune::AssetBeginInfo info{};
    env->GetIntArrayRegion(metadata, 0, 10, reinterpret_cast<jint *>(&info));
    return engine(handle).setAssetFile(
        instance, slot, info, fd, static_cast<std::uint32_t>(byteSize), format,
        revision < 0 ? std::nullopt : std::optional(static_cast<std::uint32_t>(revision)), branch);
  });
}
JNIEXPORT void JNICALL JNI_METHOD(bypass)(JNIEnv *env, jclass, jlong handle,
                                          jboolean value) {
  checked(env, 0, [&] {
    engine(handle).setBypass(value);
    return 0;
  });
}
JNIEXPORT jlong JNICALL JNI_METHOD(beginSource)(JNIEnv *env, jclass,
                                                jlong handle) {
  return checked(env, jlong{0}, [&] {
    return static_cast<jlong>(engine(handle).beginSource());
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(writePcm)(JNIEnv *env, jclass, jlong handle,
                                            jfloatArray data, jint frames,
                                            jlong generation) {
  return checked(env, jint{0}, [&] {
    if (frames < 0 || frames > 65536 || !data)
      throw std::invalid_argument("Invalid PCM frame count");
    auto &native = engine(handle);
    const auto samples = frames * native.pcmChannels();
    if (env->GetArrayLength(data) < samples)
      throw std::invalid_argument("Invalid PCM frame count");
    const int available = native.writablePcmFrames(generation);
    if (available <= 0 || frames == 0)
      return static_cast<jint>(available < 0 ? -1 : 0);
    if (frames > available)
      frames = available;
    const auto audio = floatPrefix(env, data, frames * native.pcmChannels());
    return static_cast<jint>(
        native.writePcm(audio.data(), frames, generation));
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(queuedFrames)(JNIEnv *env, jclass,
                                                jlong handle) {
  return checked(env, jint{0}, [&] {
    return static_cast<jint>(engine(handle).queuedFrames());
  });
}
JNIEXPORT jlong JNICALL JNI_METHOD(renderedFrames)(JNIEnv *env, jclass,
                                                   jlong handle) {
  return checked(env, jlong{0}, [&] {
    return static_cast<jlong>(engine(handle).renderedFrames());
  });
}
JNIEXPORT void JNICALL JNI_METHOD(playing)(JNIEnv *env, jclass, jlong handle,
                                           jboolean value) {
  checked(env, 0, [&] {
    engine(handle).setPlaying(value);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(gain)(JNIEnv *env, jclass, jlong handle,
                                        jfloat value) {
  checked(env, 0, [&] {
    if (!std::isfinite(value) || value < 0 || value > 1)
      throw std::invalid_argument("Invalid output gain");
    engine(handle).setGain(value);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(playerGain)(JNIEnv *env, jclass, jlong handle,
                                              jfloat value) {
  checked(env, 0, [&] {
    if (!std::isfinite(value) || value < 0 || value > 1)
      throw std::invalid_argument("Invalid player gain");
    engine(handle).setPlayerGain(value);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(beginMeasurementFiles)(
    JNIEnv *env, jclass, jlong handle, jint excitationFd, jint resultFd,
    jint excitationFrames, jint captureFrames, jfloat overloadPeak,
    jint overloadTailFrames, jint inputChannel) {
  checked(env, 0, [&] {
    engine(handle).beginMeasurementFiles(excitationFd, resultFd,
                                         excitationFrames, captureFrames,
                                         overloadPeak, overloadTailFrames,
                                         inputChannel);
    return 0;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(cancelMeasurement)(JNIEnv *env, jclass,
                                                     jlong handle) {
  checked(env, 0, [&] {
    engine(handle).cancelMeasurement();
    return 0;
  });
}
JNIEXPORT jintArray JNICALL JNI_METHOD(measurementState)(JNIEnv *env, jclass,
                                                         jlong handle) {
  return checked(env, static_cast<jintArray>(nullptr), [&] {
    const auto state = engine(handle).measurementState();
    auto result = env->NewIntArray(static_cast<jsize>(state.size()));
    if (result)
      env->SetIntArrayRegion(result, 0, static_cast<jsize>(state.size()),
                             state.data());
    return result;
  });
}
JNIEXPORT void JNICALL JNI_METHOD(powerSettings)(JNIEnv *env, jclass,
                                                 jlong handle, jfloat threshold,
                                                 jfloat seconds,
                                                 jboolean mustProcess) {
  checked(env, 0, [&] {
    engine(handle).setPowerSettings(threshold, seconds, mustProcess);
    return 0;
  });
}
JNIEXPORT jfloatArray JNICALL JNI_METHOD(powerObservation)(JNIEnv *env, jclass,
                                                           jlong handle) {
  return checked(env, static_cast<jfloatArray>(nullptr), [&] {
    const auto data = engine(handle).powerObservation();
    auto result = env->NewFloatArray(static_cast<jsize>(data.size()));
    if (result)
      env->SetFloatArrayRegion(result, 0, static_cast<jsize>(data.size()),
                               data.data());
    return result;
  });
}
JNIEXPORT jfloat JNICALL JNI_METHOD(meterLevel)(JNIEnv *env, jclass,
                                                jlong handle) {
  return checked(env, jfloat{0}, [&] { return engine(handle).meterLevel(); });
}
JNIEXPORT jlong JNICALL JNI_METHOD(audioFrameTime)(JNIEnv *env, jclass,
                                                   jlong handle) {
  return checked(env, jlong{0}, [&] {
    return static_cast<jlong>(engine(handle).audioFrameTime());
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(spectrumTap)(JNIEnv *env, jclass, jlong handle, jint id,
                                               jboolean enabled, jboolean compare, jboolean hq) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).setSpectrumTap(static_cast<unsigned>(id), enabled == JNI_TRUE,
                                         compare == JNI_TRUE, hq == JNI_TRUE);
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(spectrumTapRoute)(JNIEnv *env, jclass, jlong handle, jint id,
                                                    jboolean enabled) {
  return checked(env, jint{-1}, [&] {
    return engine(handle).setSpectrumTapRoute(static_cast<unsigned>(id), enabled == JNI_TRUE);
  });
}
JNIEXPORT jbyteArray JNICALL JNI_METHOD(drainSpectrum)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, static_cast<jbyteArray>(nullptr),
                 [&] { return byteArray(env, engine(handle).drainSpectrum()); });
}
JNIEXPORT jbyteArray JNICALL JNI_METHOD(telemetryPackets)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, static_cast<jbyteArray>(nullptr),
                 [&] { return byteArray(env, engine(handle).telemetryPackets()); });
}
JNIEXPORT jdoubleArray JNICALL JNI_METHOD(visualClock)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, static_cast<jdoubleArray>(nullptr), [&] {
    const auto clock = engine(handle).visualClock();
    auto result = env->NewDoubleArray(static_cast<jsize>(clock.size()));
    if (result && !clock.empty())
      env->SetDoubleArrayRegion(result, 0, static_cast<jsize>(clock.size()), clock.data());
    return result;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(visualSync)(JNIEnv *env, jclass, jlong handle,
                                              jboolean enabled) {
  return checked(env, jint{-1}, [&] { return engine(handle).setVisualSync(enabled == JNI_TRUE); });
}
JNIEXPORT jint JNICALL JNI_METHOD(visualSyncDelay)(JNIEnv *env, jclass, jlong handle,
                                                   jint samples) {
  return checked(env, jint{-1}, [&] {
    if (samples < 0)
      throw std::invalid_argument("Invalid output delay");
    return engine(handle).setVisualSyncDelay(static_cast<unsigned>(samples));
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(appliedOutputDelay)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{-1},
                 [&] { return static_cast<jint>(engine(handle).appliedOutputDelay()); });
}
JNIEXPORT jint JNICALL JNI_METHOD(scheduleParameters)(JNIEnv *env, jclass,
                                                      jlong handle,
                                                      jint instance,
                                                      jfloatArray values,
                                                      jint hash, jlong frame) {
  return checked(env, jint{-1}, [&] {
    if (frame < 0)
      throw std::invalid_argument("Invalid automation frame");
    return engine(handle).scheduleParameters(instance, floats(env, values),
                                             hash, frame);
  });
}
}

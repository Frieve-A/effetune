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
std::vector<float> floats(JNIEnv *env, jfloatArray input) {
  if (!input)
    throw std::invalid_argument("Missing parameters");
  const auto size = env->GetArrayLength(input);
  if (size > 131072)
    throw std::invalid_argument("Too many samples");
  std::vector<float> result(size);
  env->GetFloatArrayRegion(input, 0, size, result.data());
  for (const auto value : result)
    if (!std::isfinite(value))
      throw std::invalid_argument("Nonfinite audio data");
  return result;
}
} // namespace

#define JNI_METHOD(name) Java_com_frieve_effetune_NativeEngine_##name
extern "C" {
JNIEXPORT jlong JNICALL JNI_METHOD(create)(JNIEnv *env, jclass, jint rate,
                                           jint frames) {
  return checked(env, jlong{0}, [&] {
    return reinterpret_cast<jlong>(new NativeEngine(rate, frames));
  });
}
JNIEXPORT void JNICALL JNI_METHOD(destroy)(JNIEnv *, jclass, jlong handle) {
  delete reinterpret_cast<NativeEngine *>(handle);
}
JNIEXPORT jint JNICALL JNI_METHOD(start)(JNIEnv *env, jclass, jlong handle) {
  return checked(env, jint{-1}, [&] { return engine(handle).start(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(outputStatus)(JNIEnv *env, jclass,
                                                jlong handle) {
  return checked(env, jint{-1}, [&] { return engine(handle).outputStatus(); });
}
JNIEXPORT jint JNICALL JNI_METHOD(inputSessionId)(JNIEnv *env, jclass,
                                                  jlong handle) {
  return checked(env, jint{0}, [&] { return engine(handle).inputSessionId(); });
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
JNIEXPORT jintArray JNICALL
JNI_METHOD(configure)(JNIEnv *env, jclass, jlong handle, jobjectArray names,
                      jobjectArray parameterArrays, jintArray hashArray,
                      jbyteArray descriptor, jobjectArray structuredArrays) {
  return checked(env, static_cast<jintArray>(nullptr), [&] {
    if (!names || !parameterArrays || !hashArray)
      throw std::invalid_argument("Missing pipeline");
    const auto count = env->GetArrayLength(names);
    if (count > 128 || env->GetArrayLength(parameterArrays) != count ||
        env->GetArrayLength(hashArray) != count)
      throw std::invalid_argument("Invalid pipeline count");
    std::vector<std::string> types;
    std::vector<std::vector<float>> parameters;
    std::vector<std::vector<std::uint8_t>> structured;
    if (!structuredArrays || env->GetArrayLength(structuredArrays) != count)
      throw std::invalid_argument("Invalid structured parameter count");
    std::vector<std::uint32_t> hashes(count);
    env->GetIntArrayRegion(hashArray, 0, count,
                           reinterpret_cast<jint *>(hashes.data()));
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
        types, parameters, hashes, bytes(env, descriptor), structured);
    auto output = env->NewIntArray(static_cast<jsize>(result.size()));
    if (output)
      env->SetIntArrayRegion(output, 0, static_cast<jsize>(result.size()),
                             result.data());
    return output;
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
                                         jint format) {
  return checked(env, jint{-1}, [&] {
    if (!metadata || env->GetArrayLength(metadata) != 10)
      throw std::invalid_argument("Invalid asset metadata");
    effetune::AssetBeginInfo info{};
    static_assert(sizeof(info) == 10 * sizeof(jint));
    env->GetIntArrayRegion(metadata, 0, 10, reinterpret_cast<jint *>(&info));
    return engine(handle).setAsset(instance, slot, info, bytes(env, data),
                                   format);
  });
}
JNIEXPORT jbyteArray JNICALL JNI_METHOD(telemetry)(JNIEnv *env, jclass,
                                                   jlong handle) {
  return checked(env, static_cast<jbyteArray>(nullptr), [&] {
    const auto data = engine(handle).telemetry();
    auto result = env->NewByteArray(static_cast<jsize>(data.size()));
    if (result)
      env->SetByteArrayRegion(result, 0, static_cast<jsize>(data.size()),
                              reinterpret_cast<const jbyte *>(data.data()));
    return result;
  });
}
JNIEXPORT jint JNICALL JNI_METHOD(assetFile)(JNIEnv *env, jclass, jlong handle,
                                             jint instance, jint slot,
                                             jintArray metadata, jint fd,
                                             jlong byteSize, jint format) {
  return checked(env, jint{-1}, [&] {
    if (!metadata || env->GetArrayLength(metadata) != 10 || byteSize <= 0 ||
        byteSize > 1024LL * 1024 * 1024)
      throw std::invalid_argument("Invalid asset metadata");
    effetune::AssetBeginInfo info{};
    env->GetIntArrayRegion(metadata, 0, 10, reinterpret_cast<jint *>(&info));
    return engine(handle).setAssetFile(
        instance, slot, info, fd, static_cast<std::uint32_t>(byteSize), format);
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
    if (frames < 0 || frames > 65536 || !data ||
        env->GetArrayLength(data) < frames * 2)
      throw std::invalid_argument("Invalid PCM frame count");
    const auto audio = floats(env, data);
    return static_cast<jint>(
        engine(handle).writePcm(audio.data(), frames, generation));
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
    jint excitationFrames, jint captureFrames) {
  checked(env, 0, [&] {
    engine(handle).beginMeasurementFiles(excitationFd, resultFd,
                                         excitationFrames, captureFrames);
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
JNIEXPORT jlong JNICALL JNI_METHOD(audioFrameTime)(JNIEnv *env, jclass,
                                                   jlong handle) {
  return checked(env, jlong{0}, [&] {
    return static_cast<jlong>(engine(handle).audioFrameTime());
  });
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

#include "pcm_resampler.h"
#include <jni.h>
#include <stdexcept>

using effetune::android::PcmResampler;
extern "C" {
JNIEXPORT jlong JNICALL Java_com_frieve_effetune_PcmResampler_create(JNIEnv *env, jclass,
                                                                     jint input, jint output) {
  try {
    return reinterpret_cast<jlong>(new PcmResampler(input, output));
  } catch (const std::exception &error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), error.what());
    return 0;
  }
}
JNIEXPORT jfloatArray JNICALL Java_com_frieve_effetune_PcmResampler_process(
    JNIEnv *env, jclass, jlong handle, jfloatArray samples, jint frames, jboolean end) {
  try {
    if (!handle || !samples || frames < 0 || frames > 1024 ||
        env->GetArrayLength(samples) < frames * 2)
      throw std::invalid_argument("Invalid resampling block");
    float input[2048];
    env->GetFloatArrayRegion(samples, 0, frames * 2, input);
    if (env->ExceptionCheck())
      return nullptr;
    auto output = reinterpret_cast<PcmResampler *>(handle)->process(input, frames, end);
    auto result = env->NewFloatArray(static_cast<jsize>(output.size()));
    if (result)
      env->SetFloatArrayRegion(result, 0, static_cast<jsize>(output.size()), output.data());
    return result;
  } catch (const std::exception &error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
    return nullptr;
  }
}
JNIEXPORT void JNICALL Java_com_frieve_effetune_PcmResampler_destroy(JNIEnv *, jclass,
                                                                     jlong handle) {
  delete reinterpret_cast<PcmResampler *>(handle);
}
}

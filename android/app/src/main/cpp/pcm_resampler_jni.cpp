#include "pcm_resampler.h"
#include <jni.h>
#include <stdexcept>

using effetune::android::PcmResampler;
extern "C" {
JNIEXPORT jlong JNICALL Java_com_frieve_effetune_PcmResampler_create(JNIEnv *env, jclass,
                                                                     jint input, jint output, jint channels) {
  try {
    return reinterpret_cast<jlong>(new PcmResampler(input, output, channels));
  } catch (const std::exception &error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), error.what());
    return 0;
  }
}
JNIEXPORT jfloatArray JNICALL Java_com_frieve_effetune_PcmResampler_process(
    JNIEnv *env, jclass, jlong handle, jfloatArray samples, jint frames, jboolean end) {
  try {
    auto *converter = reinterpret_cast<PcmResampler *>(handle);
    if (!converter || !samples || frames < 0 || frames > 1024 ||
        env->GetArrayLength(samples) < frames * converter->channels())
      throw std::invalid_argument("Invalid resampling block");
    float stereo[2048];
    float *input = converter->channels() == 2 ? stereo : converter->wideScratch();
    env->GetFloatArrayRegion(samples, 0, frames * converter->channels(), input);
    if (env->ExceptionCheck())
      return nullptr;
    auto output = converter->process(input, frames, end);
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

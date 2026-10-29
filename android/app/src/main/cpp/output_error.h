#ifndef EFFETUNE_ANDROID_OUTPUT_ERROR_H
#define EFFETUNE_ANDROID_OUTPUT_ERROR_H

#include <atomic>
#include <oboe/Oboe.h>

namespace effetune::android {
// Each stream retains its own callback state. A late error from an old stream
// cannot affect its replacement or reference a destroyed engine.
class OutputError final : public oboe::AudioStreamErrorCallback {
public:
  bool onError(oboe::AudioStream *, oboe::Result result) override {
    error.store(static_cast<int>(result), std::memory_order_release);
    // The single control owner performs stop/close; Oboe must not race it.
    return true;
  }
  std::atomic<int> error{0};
};
} // namespace effetune::android
#endif

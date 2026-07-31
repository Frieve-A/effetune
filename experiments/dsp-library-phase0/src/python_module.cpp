#include "CompressorPluginParams.h"
#include "effetune/kernel.h"

#include <nanobind/nanobind.h>
#include <nanobind/ndarray.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace nb = nanobind;

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_CompressorPlugin() noexcept;

namespace {

using PlanarFloat32 =
    nb::ndarray<nb::numpy, float, nb::ndim<2>, nb::c_contig, nb::device::cpu>;

void checkStatus(const char *operation, et_status status) {
  if (status != ET_OK) {
    throw std::runtime_error(std::string(operation) + " failed with status " +
                             std::to_string(status));
  }
}

class KernelInstance final {
public:
  KernelInstance() {
    descriptor_ = et_kernel_descriptor_CompressorPlugin();
    if (descriptor_ == nullptr ||
        descriptor_->objectAlignment > alignof(std::max_align_t)) {
      throw std::runtime_error("Compressor kernel descriptor is unavailable");
    }
    storage_ = ::operator new(descriptor_->objectSize);
    kernel_ = descriptor_->construct(storage_);
    if (kernel_ == nullptr) {
      ::operator delete(storage_);
      storage_ = nullptr;
      throw std::runtime_error("Compressor kernel construction failed");
    }
  }

  KernelInstance(const KernelInstance &) = delete;
  KernelInstance &operator=(const KernelInstance &) = delete;

  ~KernelInstance() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
    ::operator delete(storage_);
  }

  effetune::PluginKernel &get() noexcept { return *kernel_; }

private:
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  void *storage_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

class NativeCompressor final {
public:
  NativeCompressor(float threshold, float ratio, float attack, float release,
                   float knee, float gain)
      : params_{threshold, ratio, attack, release, knee, gain} {}

  void processInPlace(PlanarFloat32 audio, double sample_rate,
                      std::uint32_t block_size) const {
    if (!std::isfinite(sample_rate) || sample_rate <= 0.0 ||
        sample_rate > static_cast<double>(std::numeric_limits<float>::max())) {
      throw std::invalid_argument(
          "sample_rate must be a positive finite number");
    }
    if (block_size == 0u) {
      throw std::invalid_argument("block_size must be positive");
    }

    const std::size_t channel_count_size = audio.shape(0);
    const std::size_t frame_count_size = audio.shape(1);
    if (channel_count_size == 0u || frame_count_size == 0u ||
        channel_count_size > std::numeric_limits<std::uint32_t>::max() ||
        frame_count_size > std::numeric_limits<std::uint32_t>::max()) {
      throw std::invalid_argument(
          "audio must have non-empty channels and frames within uint32 limits");
    }

    const auto channel_count = static_cast<std::uint32_t>(channel_count_size);
    const auto frame_count = static_cast<std::uint32_t>(frame_count_size);
    const std::uint32_t prepared_frames = std::min(block_size, frame_count);

    KernelInstance instance;
    effetune::PluginKernel &kernel = instance.get();
    kernel.prepare(
        {static_cast<float>(sample_rate), channel_count, prepared_frames});
    if (!kernel.preparedSuccessfully()) {
      throw std::runtime_error("Compressor kernel preparation failed");
    }
    checkStatus("Compressor parameter staging",
                kernel.stageParameters(
                    reinterpret_cast<const float *>(&params_),
                    effetune::generated::CompressorPluginParams::kFloatCount,
                    effetune::generated::CompressorPluginParams::kHash));

    float *const samples = audio.data();
    std::vector<float> block(static_cast<std::size_t>(channel_count) *
                             prepared_frames);
    for (std::uint32_t start = 0u; start < frame_count;) {
      const std::uint32_t frames = std::min(block_size, frame_count - start);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const float *const source =
            samples + static_cast<std::size_t>(channel) * frame_count + start;
        std::copy_n(source, frames,
                    block.data() + static_cast<std::size_t>(channel) * frames);
      }

      kernel.applyPendingParameters();
      kernel.process(block.data(), channel_count, frames,
                     {static_cast<double>(start) / sample_rate});

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        float *const target =
            samples + static_cast<std::size_t>(channel) * frame_count + start;
        std::copy_n(block.data() + static_cast<std::size_t>(channel) * frames,
                    frames, target);
      }
      start += frames;
    }
  }

private:
  effetune::generated::CompressorPluginParams params_;
};

} // namespace

NB_MODULE(_native, module) {
  module.doc() =
      "Private static-link adapter for the EffeTune DSP library Phase 0 PoC";

  nb::class_<NativeCompressor>(module, "_NativeCompressor")
      .def(nb::init<float, float, float, float, float, float>(),
           nb::arg("threshold"), nb::arg("ratio"), nb::arg("attack"),
           nb::arg("release"), nb::arg("knee"), nb::arg("gain"))
      .def("process_in_place", &NativeCompressor::processInPlace,
           nb::arg("audio").noconvert(), nb::arg("sample_rate"),
           nb::arg("block_size"));
}

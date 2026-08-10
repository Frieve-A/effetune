#include "effetune/kernel.h"

#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace effetune::test {

struct TestGainParams {
  float gain;
  static constexpr std::uint32_t kHash = 0xa17e5eedu;
  static constexpr std::uint32_t kFloatCount = 1;
};

class TestGainKernel final : public PluginKernel {
  EFFETUNE_PARAMS(TestGainParams)

public:
  ~TestGainKernel() override { std::free(asset_); }

  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == 0u ? 4096u : 0u;
  }

  void prepare(const PrepareInfo &info) override { sample_rate_ = info.sampleRate; }

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (asset_state_ == ET_ASSET_STATE_PREPARING) {
      asset_state_ = ET_ASSET_STATE_ACTIVE;
    }
    const float gain = asset_state_ == ET_ASSET_STATE_ACTIVE ? params_.gain * 2.0F : params_.gain;
    const std::uint32_t samples = channel_count * frame_count;
    for (std::uint32_t index = 0; index < samples; ++index) {
      audio[index] *= gain;
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    writer.write(0x7fffu, 1u, &params_.gain, static_cast<std::uint16_t>(sizeof(params_.gain)));
  }

  [[nodiscard]] std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }

  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    if (assetCapacityForSlot(slot) == 0u || info.byteSize > assetCapacityForSlot(slot)) {
      return nullptr;
    }
    auto *next = static_cast<std::uint8_t *>(std::malloc(info.byteSize));
    if (next == nullptr) {
      return nullptr;
    }
    std::free(asset_);
    asset_ = next;
    asset_info_ = info;
    asset_state_ = ET_ASSET_STATE_STAGED;
    return asset_;
  }

  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t format_tag) noexcept override {
    if (slot != 0u || asset_state_ != ET_ASSET_STATE_STAGED || asset_ == nullptr ||
        bytes != asset_info_.byteSize || format_tag != ET_ASSET_F32_MULTICH || bytes < 32u) {
      clearAsset(slot);
      asset_state_ = ET_ASSET_STATE_ERROR;
      return ET_ERR_ARGS;
    }
    std::uint32_t header[8]{};
    std::memcpy(header, asset_, sizeof(header));
    const std::uint64_t sample_bytes =
        static_cast<std::uint64_t>(asset_info_.channels) * asset_info_.frames * sizeof(float);
    const std::uint64_t expected_bytes = sizeof(header) + sample_bytes;
    if (header[0] != 0x31415445u || header[1] != asset_info_.channels ||
        header[2] != asset_info_.frames || header[3] != sample_rate_ / asset_info_.rateDivider ||
        header[4] != asset_info_.topology || expected_bytes != bytes) {
      clearAsset(slot);
      asset_state_ = ET_ASSET_STATE_ERROR;
      return ET_ERR_ARGS;
    }
    asset_state_ = ET_ASSET_STATE_PREPARING;
    return ET_OK;
  }

  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != 0u) {
      return;
    }
    std::free(asset_);
    asset_ = nullptr;
    asset_info_ = {};
    asset_state_ = ET_ASSET_STATE_NONE;
  }

  [[nodiscard]] std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == 0u ? asset_state_ : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }

private:
  std::uint8_t *asset_ = nullptr;
  AssetBeginInfo asset_info_{};
  float sample_rate_ = 0.0F;
  std::uint32_t asset_state_ = ET_ASSET_STATE_NONE;
};

struct TestDelayParams {
  static constexpr std::uint32_t kHash = 0xd31a0192u;
  static constexpr std::uint32_t kFloatCount = 0u;
};

class TestDelayKernel final : public PluginKernel {
  EFFETUNE_PARAMS(TestDelayParams)

public:
  static constexpr std::uint32_t kLatencySamples = 192u;
  static constexpr std::uint32_t kDelayLength = kLatencySamples + 1u;

  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override {
    samples_.fill(0.0F);
    write_indices_.fill(0u);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t channel_offset = channel * kDelayLength;
      std::uint32_t write_index = write_indices_[channel];
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        samples_[channel_offset + write_index] = audio[channel * frame_count + frame];
        std::uint32_t read_index = write_index + kDelayLength - kLatencySamples;
        if (read_index >= kDelayLength) {
          read_index -= kDelayLength;
        }
        audio[channel * frame_count + frame] = samples_[channel_offset + read_index];
        ++write_index;
        if (write_index == kDelayLength) {
          write_index = 0u;
        }
      }
      write_indices_[channel] = write_index;
    }
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override { return kLatencySamples; }

private:
  std::array<float, 8u * kDelayLength> samples_{};
  std::array<std::uint32_t, 8> write_indices_{};
};

} // namespace effetune::test

EFFETUNE_REGISTER_KERNEL(TestGainPlugin, effetune::test::TestGainKernel)
EFFETUNE_REGISTER_KERNEL(TestDelayPlugin, effetune::test::TestDelayKernel)

#include "CassetteArtifactsPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_CassetteArtifactsPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::CassetteArtifactsPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Cassette Artifacts check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  KernelHarness() {
    descriptor_ = et_kernel_descriptor_CassetteArtifactsPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({48000.0F, 4u, kMaximumFrames});
      kernel_->reset();
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void seed(std::uint32_t low, std::uint32_t high) noexcept {
    if (kernel_ != nullptr) {
      kernel_->setRandomSeed(low, high);
      kernel_->reset();
    }
  }

  void stage(const Params &params) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    const et_status status =
        kernel_->stageParameters(&params.deckGrade, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    check(audio.size() == static_cast<std::size_t>(channels) * frames, "audio shape matches");
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio.data(), channels, frames, {0.0});
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

// Consumer deck, Type I, Dolby B, every stochastic family live.
Params cassetteParams(float mix) noexcept {
  return {2.0F, 0.0F, 1.0F, 0.0F, 9.0F, 0.25F, -60.5F, 2.0F, 2.0F, 0.0F, 0.0F, mix};
}

// Reference deck with wf = 0, hs at the bottom and dp = 0: no family draws.
Params silentFamiliesParams() noexcept {
  return {0.0F, 1.0F, 0.0F, 0.0F, 9.0F, 0.0F, -92.0F, 0.0F, 2.0F, 0.0F, 0.0F, 100.0F};
}

std::vector<float> signal(std::uint32_t frames, std::uint32_t channels, std::uint32_t phase) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::uint32_t offset = channel * frames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      result[offset + frame] =
          static_cast<float>(0.61 * std::sin((frame + phase + channel * 11u) * 0.137) +
                             0.23 * std::cos((frame + phase * 3u + channel) * 0.053));
    }
  }
  return result;
}

std::vector<float> renderSequence(KernelHarness &harness, const Params &params) {
  constexpr std::array<std::uint32_t, 4> block_sizes = {63u, 128u, 17u, 91u};
  std::vector<float> rendered;
  for (std::size_t block = 0u; block < block_sizes.size(); ++block) {
    const std::uint32_t frames = block_sizes[block];
    std::vector<float> audio = signal(frames, 2u, static_cast<std::uint32_t>(block) * 131u + 7u);
    harness.stage(params);
    harness.process(audio, 2u, frames);
    rendered.insert(rendered.end(), audio.begin(), audio.end());
  }
  return rendered;
}

bool finite(const std::vector<float> &audio) noexcept {
  for (const float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

void testSeedAndResetReplay() {
  constexpr std::uint32_t seed_low = 0x13579bdfu;
  constexpr std::uint32_t seed_high = 0x2468ace0u;
  const Params params = cassetteParams(100.0F);

  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.seed(seed_low, seed_high);
  const std::vector<float> replay = renderSequence(harness, params);
  harness.seed(seed_low ^ 0x01010101u, seed_high);
  const std::vector<float> different_seed = renderSequence(harness, params);

  check(first == replay, "reset and reseed reproduce every stochastic family");
  check(first != different_seed,
        "a different seed moves the transport, the hiss, the dropouts and the azimuth");
  check(finite(first), "seeded output remains finite");
}

void testBlockSizeIndependence() {
  constexpr std::uint32_t seed_low = 0x0badc0deu;
  constexpr std::uint32_t seed_high = 0x51ab1e00u;
  const Params params = cassetteParams(100.0F);
  const std::uint32_t frames = 128u;
  const std::vector<float> source = signal(frames, 2u, 41u);

  KernelHarness single;
  single.seed(seed_low, seed_high);
  std::vector<float> whole = source;
  single.stage(params);
  single.process(whole, 2u, frames);

  KernelHarness split;
  split.seed(seed_low, seed_high);
  std::vector<float> halves(static_cast<std::size_t>(frames) * 2u);
  const std::uint32_t first_frames = 53u;
  const std::uint32_t second_frames = frames - first_frames;
  std::vector<float> head(static_cast<std::size_t>(first_frames) * 2u);
  std::vector<float> tail(static_cast<std::size_t>(second_frames) * 2u);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = 0u; frame < first_frames; ++frame) {
      head[channel * first_frames + frame] = source[channel * frames + frame];
    }
    for (std::uint32_t frame = 0u; frame < second_frames; ++frame) {
      tail[channel * second_frames + frame] = source[channel * frames + first_frames + frame];
    }
  }
  split.stage(params);
  split.process(head, 2u, first_frames);
  split.stage(params);
  split.process(tail, 2u, second_frames);
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = 0u; frame < first_frames; ++frame) {
      halves[channel * frames + frame] = head[channel * first_frames + frame];
    }
    for (std::uint32_t frame = 0u; frame < second_frames; ++frame) {
      halves[channel * frames + first_frames + frame] = tail[channel * second_frames + frame];
    }
  }

  check(whole == halves, "splitting a block leaves the rendered output unchanged");
}

void testZeroMixFreezesStateBeforeChannelChange() {
  constexpr std::uint32_t seed_low = 0xeffe7a5eu;
  constexpr std::uint32_t seed_high = 0x10203040u;
  KernelHarness paused;
  KernelHarness uninterrupted;
  paused.seed(seed_low, seed_high);
  uninterrupted.seed(seed_low, seed_high);

  std::vector<float> prefix_paused = signal(127u, 2u, 19u);
  std::vector<float> prefix_uninterrupted = prefix_paused;
  paused.stage(cassetteParams(100.0F));
  uninterrupted.stage(cassetteParams(100.0F));
  paused.process(prefix_paused, 2u, 127u);
  uninterrupted.process(prefix_uninterrupted, 2u, 127u);
  check(prefix_paused == prefix_uninterrupted, "prefixes start in lockstep");

  std::vector<float> bypass = signal(61u, 4u, 137u);
  const std::vector<float> bypass_input = bypass;
  paused.stage(cassetteParams(0.0F));
  paused.process(bypass, 4u, 61u);
  check(bypass == bypass_input, "zero mix returns every channel unchanged");

  std::vector<float> suffix_paused = signal(113u, 2u, 257u);
  std::vector<float> suffix_uninterrupted = suffix_paused;
  paused.stage(cassetteParams(100.0F));
  uninterrupted.stage(cassetteParams(100.0F));
  paused.process(suffix_paused, 2u, 113u);
  uninterrupted.process(suffix_uninterrupted, 2u, 113u);
  check(suffix_paused == suffix_uninterrupted,
        "zero mix freezes every stream and defers the channel-count reset");
}

void testChannelCountChangeRebuildsState() {
  constexpr std::uint32_t seed_low = 0x31415926u;
  constexpr std::uint32_t seed_high = 0x27182818u;
  KernelHarness widened;
  KernelHarness fresh;
  widened.seed(seed_low, seed_high);
  fresh.seed(seed_low, seed_high);

  std::vector<float> stereo_prefix = signal(97u, 2u, 11u);
  const Params params = cassetteParams(100.0F);
  widened.stage(params);
  widened.process(stereo_prefix, 2u, 97u);
  check(finite(stereo_prefix), "stereo prefix remains finite");

  std::vector<float> widened_quad = signal(89u, 4u, 211u);
  std::vector<float> fresh_quad = widened_quad;
  const std::vector<float> quad_input = widened_quad;
  widened.stage(params);
  fresh.stage(params);
  widened.process(widened_quad, 4u, 89u);
  fresh.process(fresh_quad, 4u, 89u);

  bool every_channel_changed = true;
  for (std::uint32_t channel = 0u; channel < 4u; ++channel) {
    bool channel_changed = false;
    for (std::uint32_t frame = 0u; frame < 89u; ++frame) {
      const std::size_t index = static_cast<std::size_t>(channel) * 89u + frame;
      channel_changed = channel_changed || widened_quad[index] != quad_input[index];
    }
    every_channel_changed = every_channel_changed && channel_changed;
  }
  check(every_channel_changed, "all four channels are processed");
  check(widened_quad != fresh_quad,
        "a channel-count change redraws the seed rather than reusing the stereo stream");
  check(finite(widened_quad) && finite(fresh_quad), "four-channel output remains finite");
}

// The Reference Grade has an azimuth servo, so wf = 0, hs at the bottom and
// dp = 0 leave a deck with no stochastic family running at all: two different
// seeds must then render the same samples.
void testSilentFamiliesAreSeedIndependent() {
  const Params params = silentFamiliesParams();
  KernelHarness first_seed;
  KernelHarness second_seed;
  first_seed.seed(0x0000beefu, 0x00001234u);
  second_seed.seed(0xdeadbeefu, 0x76543210u);

  std::vector<float> first = signal(101u, 2u, 5u);
  std::vector<float> second = first;
  first_seed.stage(params);
  second_seed.stage(params);
  first_seed.process(first, 2u, 101u);
  second_seed.process(second, 2u, 101u);

  check(first == second, "wf = 0, hs off, dp = 0 and Reference leave a deterministic deck");
  check(finite(first), "deterministic configuration remains finite");
}

// A Dolby mode change crossfades over 20 ms and must not disturb any other
// family: the same render with the mode held constant diverges only through
// the compander, so both stay finite and the fade converges.
void testDolbyModeChangeCrossfades() {
  constexpr std::uint32_t seed_low = 0x5a5a5a5au;
  constexpr std::uint32_t seed_high = 0xa5a5a5a5u;
  KernelHarness harness;
  harness.seed(seed_low, seed_high);

  Params params = cassetteParams(100.0F);
  std::vector<float> warm = signal(128u, 2u, 3u);
  harness.stage(params);
  harness.process(warm, 2u, 128u);
  check(finite(warm), "Dolby B warm-up remains finite");

  params.noiseReduction = 2.0F; // Dolby C
  std::vector<float> faded = signal(128u, 2u, 71u);
  harness.stage(params);
  harness.process(faded, 2u, 128u);
  check(finite(faded), "the crossfade into Dolby C remains finite");

  params.noiseReduction = 0.0F; // Off
  std::vector<float> back_off = signal(128u, 2u, 149u);
  harness.stage(params);
  harness.process(back_off, 2u, 128u);
  check(finite(back_off), "the crossfade back to Off remains finite");
}

} // namespace

int main() {
  testSeedAndResetReplay();
  testBlockSizeIndependence();
  testZeroMixFreezesStateBeforeChannelChange();
  testChannelCountChangeRebuildsState();
  testSilentFamiliesAreSeedIndependent();
  testDolbyModeChangeCrossfades();
  return failures == 0 ? 0 : 1;
}

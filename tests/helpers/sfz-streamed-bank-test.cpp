#include "../../dsp/plugins/others/sfz/bank.h"
#include <cstdio>
#include <fstream>
#include <vector>

namespace {
bool require(bool value, const char *message) {
  if (!value)
    std::fprintf(stderr, "%s\n", message);
  return value;
}
} // namespace

int main(int argc, char **argv) {
  using namespace effetune;
  using namespace effetune::plugins::others::sfz;
  if (argc != 2 && argc != 3)
    return 2;
  std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
  if (!input)
    return 2;
  const auto size = static_cast<std::size_t>(input.tellg());
  if (size < 100 || size > 128 * 1024 * 1024)
    return 2;
  std::vector<std::uint8_t> bytes(size);
  input.seekg(0);
  input.read(reinterpret_cast<char *>(bytes.data()),
             static_cast<std::streamsize>(size));
  const auto footprint = SFZBank::readU32(bytes.data());
  const auto payloadSize = static_cast<std::uint32_t>(size - 4);
  const AssetBeginInfo info{
      1, (payloadSize - 32) / 4, 0, 128, 1, 0, 0, 1, footprint, payloadSize};
  SFZBank bank;
  if (!require(bank.allocate(info) == ET_OK, "allocate"))
    return 1;
  std::memcpy(bank.payload_.data(), bytes.data() + 4, payloadSize);
  const auto committed = bank.commit(payloadSize, ET_ASSET_F32_MULTICH);
  if (argc == 3 && std::strcmp(argv[2], "sf2-collection") == 0) {
    const auto *header = bytes.data() + 4u + 32u;
    const auto regions = SFZBank::readU32(header + 8u);
    if (!require(committed == (kSf2RenderingSupported ? ET_OK : ET_ERR_ARGS) &&
                     bank.sf2_ && bank.validPresets(regions) &&
                     bank.validSf2Modulation(regions),
                 "SF2 collection validation"))
      return 1;
    bank.region_count_ = regions;
    bank.group_count_ = SFZBank::readU32(header + 24u);
    for (auto index = 0u; index < regions; ++index)
      if (!require(bank.validRegion(bank.region(index)) &&
                       bank.presetForRegion(index) != UINT32_MAX,
                   "SF2 collection region")) {
        std::fprintf(stderr, "region index: %u\n", index);
        return 1;
      }
    std::printf("SF2 collection: %u presets, %u regions, %u samples, %u cache "
                "slots validated\n",
                bank.preset_count_, regions, bank.sample_count_,
                bank.cache_slots_);
    return 0;
  }
  if (argc == 3 && std::strcmp(argv[2], "sf2") == 0) {
    bank.region_count_ = 1u;
    bank.group_count_ = 1u;
    if (!require(committed == (kSf2RenderingSupported ? ET_OK : ET_ERR_ARGS),
                 "SF2 rendering capability gate") ||
        !require(bank.sf2_scratch_.size() == 10u && bank.sf2_ &&
                     bank.streamed_ && bank.header_words_ == 18u &&
                     bank.preset_count_ == 2u && bank.validPresets(1u) &&
                     bank.validSf2Modulation(1u),
                 "SF2 collection structure") ||
        !require(bank.validRegion(bank.region(0)) &&
                     bank.region(0)[LowVelocity] == 0.0F &&
                     bank.findPreset(0, 0) == 1u &&
                     bank.findPreset(65535, 65535) == UINT32_MAX &&
                     bank.presetForRegion(0) == 1u &&
                     bank.presetForRegion(1) == UINT32_MAX &&
                     bank.preset(0).regionCount == 0u &&
                     bank.sf2Generators(0)[48] == 120.0F,
                 "SF2 preset and raw generator access"))
      return 1;
    auto *section = bank.payload_.data() + 8u + bank.modulation_offset_;
    const auto records = std::bit_cast<std::uint32_t>(section[6]);
    const auto transform = section[records + 9u];
    section[records + 9u] = std::bit_cast<float>(1u);
    if (!require(!bank.validSf2Modulation(1u),
                 "SF2 invalid transform rejection"))
      return 1;
    section[records + 9u] = transform;
    const auto source = section[records + 1u];
    section[records + 1u] = std::bit_cast<float>(0x20001u);
    if (!require(!bank.validSf2Modulation(1u),
                 "SF2 out-of-region link rejection"))
      return 1;
    section[records + 1u] = source;
    const auto generators = std::bit_cast<std::uint32_t>(section[8]);
    section[generators] = std::numeric_limits<float>::quiet_NaN();
    if (!require(!bank.validSf2Modulation(1u),
                 "SF2 nonfinite generator rejection"))
      return 1;
    std::puts("SF2 bank: preserved preset directory, raw generators, route "
              "validation and capability gate passed");
    return 0;
  }
  if (argc == 3 && std::strcmp(argv[2], "reject") == 0)
    return require(committed == ET_ERR_ARGS, "reject unsupported routes") ? 0
                                                                          : 1;
  if (!require(committed == ET_OK, "commit"))
    return 1;
  bank.prepareSlice(UINT64_MAX);
  if (!require(bank.state_ == ET_ASSET_STATE_PREPARING &&
                   bank.preparation_ == 3,
               "head wait"))
    return 1;
  const std::uint64_t generation = (UINT64_C(1) << 32) + 7;
  if (!require(bank.configureSampleStream(generation) == ET_OK &&
                   bank.configureSampleStream(generation) == ET_OK &&
                   bank.configureSampleStream(generation + 1) == ET_ERR_STATE,
               "generation"))
    return 1;
  if (!require(bank.cache_.capacityBytes() == 8u * 4096u * sizeof(float),
               "mono cache capacity"))
    return 1;
  std::array<float, 8192> pcm{};
  for (std::size_t index = 0; index < pcm.size(); ++index)
    pcm[index] = static_cast<float>(index % 128) / 128.0F;
  const auto publish = [&](std::uint32_t sample, std::uint64_t page,
                           bool resident) {
    const auto *metadata = bank.cache_.metadata(sample);
    const auto remaining = metadata->frames - page * 4096;
    return bank.publishSamplePage(
        generation, sample, page, pcm.data(),
        static_cast<std::uint32_t>(std::min<std::uint64_t>(4096, remaining)),
        metadata->channels, resident ? 1 : 0);
  };
  if (!require(publish(0, 0, true) == ET_OK && publish(0, 1, true) == ET_OK &&
                   publish(0, 3, true) == ET_OK &&
                   publish(1, 4095, true) == ET_OK &&
                   publish(1, 4096, false) == ET_OK &&
                   bank.state_ == ET_ASSET_STATE_PREPARING,
               "resident onset requirement"))
    return 1;
  if (!require(publish(1, 4096, true) == ET_OK &&
                   bank.state_ == ET_ASSET_STATE_ACTIVE,
               "activation"))
    return 1;
  const auto fingerprint = bank.fingerprint_;
  if (!require(indexValue(bank.region(2), Offset) == 16777217u &&
                   bank.cache_.metadata(1)->frames == 16777223u,
               "exact sample positions"))
    return 1;
  float sample = 0;
  if (!require(!bank.cache_.sample(0, 8192, 0, sample), "tail miss"))
    return 1;
  std::array<et_sfz_sample_request, 4> requests{};
  std::uint32_t count = 0;
  if (!require(bank.takeSampleRequests(requests.data(), 4, count) == ET_OK &&
                   count == 1 && requests[0].generation_low == 7 &&
                   requests[0].generation_high == 1 &&
                   requests[0].page_low == 2 && requests[0].sample == 0 &&
                   requests[0].reserved == 0,
               "request transport"))
    return 1;
  if (!require(publish(0, 2, false) == ET_OK &&
                   bank.cache_.sample(0, 8193, 0, sample) && sample == pcm[1] &&
                   bank.fingerprint_ == fingerprint,
               "tail publication"))
    return 1;
  std::unique_ptr<PreparedAsset> prepared;
  if (!require(!bank.cache_.sample(1, 0, 0, sample),
               "terminal pending request"))
    return 1;
  bank.state_ = ET_ASSET_STATE_ERROR;
  count = 99;
  if (!require(bank.takeSampleRequests(requests.data(), 4, count) ==
                       ET_ERR_STATE &&
                   count == 0,
               "terminal source retires even without MIDI transport"))
    return 1;
  bank.state_ = ET_ASSET_STATE_PREPARING;
  if (!require(bank.takeSampleRequests(requests.data(), 4, count) == ET_OK &&
                   count == 1,
               "preparing source may drain requests"))
    return 1;
  if (!require(SFZBank::prepare({48000, 2, 128}, info, bytes.data() + 4,
                                ET_ASSET_F32_MULTICH, prepared) == ET_OK &&
                   prepared->configureSampleStream(generation) == ET_OK,
               "prepared update waits for heads"))
    return 1;
  std::puts("streamed bank: v8 metadata, resident onsets, exact positions, "
            "generation and tail page passed");
}

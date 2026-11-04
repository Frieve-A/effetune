#include "modulation_bank.h"
#include "preparation_fixture.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <vector>
namespace sfz = effetune::plugins::others::sfz;
using P = sfz::schema::Property;
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    std::exit(1);
  }
}
static std::vector<float> payload() {
  std::vector<float> result;
  for (const auto word : kPreparationWords)
    result.push_back(std::bit_cast<float>(word));
  return result;
}
static std::uint32_t parameter(const sfz::modulation::RegionView &view, P property) {
  for (auto i = 0u; i < view.parameters.size(); ++i)
    if (view.parameters[i].property == static_cast<unsigned>(property))
      return i;
  std::abort();
}
static et_status load(sfz::ModulationBank &bank, const std::vector<float> &data,
                      std::uint64_t budget = kPreparationBudget) {
  return bank.load(data.data(), static_cast<std::uint32_t>(data.size()), kPreparationRegions,
                   budget, 0x3fffffffu, [](std::uint32_t, std::uint32_t) { return true; });
}
static void variables() {
  std::vector<float> data;
  for (const auto word : kVariableWords)
    data.push_back(std::bit_cast<float>(word));
  sfz::ModulationBank bank;
  const auto admit = [&](const auto &words) {
    return bank.load(words.data(), static_cast<std::uint32_t>(words.size()), 1, kVariableBudget,
                     0x7fffffffu, [](std::uint32_t, std::uint32_t) { return true; });
  };
  require(admit(data) == ET_OK && bank.prepareState(), "canonical grouped variable payload admits");
  const auto view = bank.region(0);
  require((view.variableFlags & 1u) && !(view.variableFlags & 2u),
          "ordinary controller variables are event cached");
  std::uint32_t variable = UINT32_MAX;
  for (auto i = 0u; i < view.instances.size(); ++i)
    if (view.instances[i].kind == static_cast<unsigned>(sfz::schema::Kind::Variable) &&
        view.instances[i].authoredIndex == 1u)
      variable = i;
  require(variable != UINT32_MAX, "sparse variable identity is preserved");
  const auto inputs = view.preparedGenerators[variable].parameters.variable;
  require(inputs.count == 3u, "all three interleaved inputs become one prepared group");
  const auto variableParameter = view.instances[variable].firstParameter;
  const auto routeOffset = kVariableWords[6];
  const auto parameterOffset = kVariableWords[10];
  auto bad = data;
  // Move an ordinary physical output into the middle of a variable input group.
  for (auto word = 0u; word < sfz::schema::kRouteWords; ++word)
    std::swap(bad[routeOffset + word],
              bad[routeOffset + (inputs.firstRoute + 1u) * sfz::schema::kRouteWords + word]);
  require(admit(bad) == ET_ERR_ARGS, "public wire rejects a discontiguous variable group");
  bad = data;
  bad[routeOffset + inputs.firstRoute * sfz::schema::kRouteWords + 1u] =
      std::bit_cast<float>(0x60000u | variable);
  require(admit(bad) == ET_ERR_ARGS, "recursive variable inputs are rejected");
  bad = data;
  bad[routeOffset + inputs.firstRoute * sfz::schema::kRouteWords + 6u] = 1.0F;
  require(admit(bad) == ET_ERR_ARGS, "variable inputs cannot hide smoothing state");
  bad = data;
  bad[parameterOffset + variableParameter * sfz::schema::kParameterWords + 2u] = .5F;
  require(admit(bad) == ET_ERR_ARGS, "variable base is the declared add/product identity");
}
int main() {
  variables();
  auto data = payload();
  sfz::ModulationBank bank;
  require(bank.load(data.data(), static_cast<unsigned>(data.size()), kPreparationRegions,
                    kPreparationBudget) == ET_ERR_UNSUPPORTED,
          "new typed kinds remain closed without actual engine capability");
  require(load(bank, data) == ET_OK,
          "normal compiler payload fits its declared preparation budget");
  require(bank.prepareState(), "prepare actual preallocated voice state");
  require(bank.noteOffset() == -3 && bank.switchOffset() == 12,
          "validated collection control offsets");
  require(bank.hasSource && bank.state.hasOscillatorState() && bank.preview.hasOscillatorState(),
          "only used source banks allocate phase pools");
  sfz::ModulationStatePool trial;
  require(trial.prepare(bank.maximum, 128, bank.hasSource, bank.hasVoiceDsp, bank.hasNoise),
          "all used optional trial pools prepared off audio");
  bank.state.oscillatorState(0).phase[2] = .375;
  bank.state.oscillatorState(0).random[2].seed(1234);
  (void)bank.state.oscillatorState(0).random[2].nextU64();
  trial.copyFrom(bank.state);
  require(trial.oscillatorState(0).phase[2] == .375 &&
              trial.oscillatorState(0).random[2].nextU64() ==
                  bank.state.oscillatorState(0).random[2].nextU64(),
          "trial captures exact phase and random sequence");
  sfz::ModulationStatePool noSource;
  require(noSource.prepare({}, 1) && !noSource.hasOscillatorState(),
          "ordinary banks have no source phase pool");
  const auto view = bank.region(0);
  const auto delay = parameter(view, P::DelaySamples), offset = parameter(view, P::Offset);
  require(bank.integerBase(0, delay) == 4294967296ULL, "UInt33 high bit remains exact");
  require(bank.integerBase(0, parameter(view, P::OscillatorTableSize)) == 16777217ULL,
          "UInt32 above float exactness remains exact");
  require(view.parameters[delay].base == 0, "integer base never seeds rounded generic float lane");
  require(bank.plan(0).noteEnabled && !bank.plan(0).silentAction && !bank.plan(1).noteEnabled &&
              bank.plan(1).silentAction,
          "CONTROL caches ordinary and silent CC-only region selection");
  const auto *playback = bank.playbackPlan(0);
  require(playback && playback->sampleQuality == 10,
          "CONTROL caches sample quality without a birth property scan");
  require(playback && playback->timing.delaySamples == 4294967296.0 &&
              playback->playCount == 4294967296ULL,
          "CONTROL playback settings use full integer domain");
  require(playback->decay.size() == 2 && playback->decay[0].authoredIndex == 1 &&
              playback->decay[0].rate == -10,
          "release segments sort authored indices without losing signed rate");
  require(playback->reverse.size() == 1 && playback->reverse[0].controller == 64,
          "prepared reverse range");
  require(bank.initialController(90) == .333F && bank.initialController(89) == -1,
          "high resolution initialization and absent sentinel");
  require(bank.plan(0).sourceInstance != UINT32_MAX &&
              bank.plan(0).amplifierInstance != UINT32_MAX &&
              bank.plan(0).equalizers[0] != UINT32_MAX,
          "CONTROL caches used typed instances");
  for (unsigned group = 0; group < 3; ++group)
    require(bank.plan(0).conditions[group].size() == 1, "condition action spans remain separate");
  std::array<std::uint8_t, 128> cc{};
  for (const auto value : {0, 1, 64, 127}) {
    cc[1] = cc[2] = static_cast<std::uint8_t>(value);
    require(bank.integerContribution(0, delay, cc) ==
                -16777217.0 * (static_cast<double>(value) / 127.0),
            "exact signed integer CC depth");
    require(bank.integerContribution(0, offset, cc) ==
                4294967296.0 * (static_cast<double>(value) / 127.0),
            "exact high-bit offset CC depth");
  }
  require(bank.integerContributionWithController(
              0, delay, [](std::uint32_t) { return static_cast<double>(.333F); }) ==
              -16777217.0 * static_cast<double>(.333F),
          "precise initialized CC can retain declared continuous value");
  const auto parameterOffset = kPreparationWords[10];
  const auto secondNoteOffset = parameter(bank.region(1), P::NoteOffset);
  require(load(bank, data, 1) == ET_ERR_ARGS, "small real memory budget rejects preparation");
  auto mismatched = data;
  const auto secondFirstParameter = kPreparationWords[kPreparationWords[5] + 6u + 4u];
  mismatched[parameterOffset + (secondFirstParameter + secondNoteOffset) * 4u + 2u] = 4;
  require(load(bank, mismatched) == ET_ERR_ARGS,
          "different per-region control offsets are not silently chosen from first region");
  auto bad = data;
  bad[parameterOffset + delay * 4 + 3] = std::bit_cast<float>(2u);
  require(load(bank, bad) == ET_ERR_ARGS, "reserved UInt33 high bits rejected");
  bad = data;
  bad[parameterOffset + delay * 4 + 2] = std::bit_cast<float>(1u);
  require(load(bank, bad) == ET_ERR_ARGS, "UInt33 above public two-power32 rejected");
  const auto routeOffset = kPreparationWords[6];
  bad = data;
  bad[routeOffset + 8] = std::bit_cast<float>(64u);
  require(load(bank, bad) == ET_ERR_ARGS, "unknown route flags rejected");
  std::puts("SFZ preparation tests passed");
}

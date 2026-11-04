#include "../sfz/engine.h"
#include "SoundFontPlayerPluginParams.h"
namespace effetune::plugins::others {
using SoundFontPlayerKernel = SFZEngine<generated::SoundFontPlayerPluginParams, true>;
}
EFFETUNE_REGISTER_KERNEL(SoundFontPlayerPlugin, effetune::plugins::others::SoundFontPlayerKernel)

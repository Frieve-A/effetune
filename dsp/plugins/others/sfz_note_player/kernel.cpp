#include "../sfz/engine.h"
#include "SFZNotePlayerPluginParams.h"
namespace effetune::plugins::others {
using SFZNotePlayerKernel = SFZEngine<generated::SFZNotePlayerPluginParams, false>;
}
EFFETUNE_REGISTER_KERNEL(SFZNotePlayerPlugin, effetune::plugins::others::SFZNotePlayerKernel)

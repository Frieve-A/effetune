#include "../fir_asset_eq_common.h"
#include "GroupDelayPEQPluginParams.h"

namespace effetune::plugins::eq {
using GroupDelayPEQKernel = FirAssetEqKernel<generated::GroupDelayPEQPluginParams>;
} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(GroupDelayPEQPlugin, effetune::plugins::eq::GroupDelayPEQKernel)

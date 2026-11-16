#include "../fir_asset_eq_common.h"
#include "GroupDelayEqPluginParams.h"

namespace effetune::plugins::eq {
using GroupDelayEqKernel = FirAssetEqKernel<generated::GroupDelayEqPluginParams>;
} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(GroupDelayEqPlugin, effetune::plugins::eq::GroupDelayEqKernel)

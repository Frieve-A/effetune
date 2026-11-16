#include "../fir_asset_eq_common.h"
#include "HeadphoneEQPluginParams.h"

namespace effetune::plugins::eq {
using HeadphoneEQKernel = FirAssetEqKernel<generated::HeadphoneEQPluginParams>;
} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(HeadphoneEQPlugin, effetune::plugins::eq::HeadphoneEQKernel)

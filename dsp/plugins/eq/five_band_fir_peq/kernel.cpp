#include "../fir_asset_eq_common.h"
#include "FiveBandFIRPEQPluginParams.h"

namespace effetune::plugins::eq {
using FiveBandFIRPEQKernel = FirAssetEqKernel<generated::FiveBandFIRPEQPluginParams>;
} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(FiveBandFIRPEQPlugin, effetune::plugins::eq::FiveBandFIRPEQKernel)

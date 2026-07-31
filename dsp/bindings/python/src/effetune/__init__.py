"""EffeTune Python DSP library."""

from copy import deepcopy
from importlib.metadata import PackageNotFoundError, version

from ._base import Effect
from ._generated_effects import *  # noqa: F403
from ._generated_effects import EFFECT_METADATA as _INTERNAL_EFFECT_METADATA
from ._generated_effects import __all__ as _generated_all
from .assets import AssetData, AssetResolver, ConvolutionPath
from .bundle import Bundle
from .chain import Chain, Stream
from .errors import (
    AssetError,
    EffectError,
    EffeTuneError,
    EffeTuneRuntimeError,
    StateError,
    ValidationError,
)
from .presets import LegacyImportReport, import_legacy_preset
from .telemetry import (
    LevelTelemetryChannel,
    LevelTelemetryFrame,
    OscilloscopeTelemetryFrame,
    SpectrogramTelemetryFrame,
    SpectrumTelemetryFrame,
    StereoTelemetryFrame,
    TelemetryFrame,
)

# Keep mutable public catalog data isolated from runtime validation metadata.
EFFECT_METADATA = deepcopy(_INTERNAL_EFFECT_METADATA)

try:
    __version__ = version("effetune")
except PackageNotFoundError:
    # An unpacked source tree has no installed distribution metadata.
    __version__ = "0+source"

__all__ = [
    "AssetData",
    "AssetError",
    "AssetResolver",
    "Bundle",
    "Chain",
    "ConvolutionPath",
    "Effect",
    "EffectError",
    "EffeTuneError",
    "EffeTuneRuntimeError",
    "LegacyImportReport",
    "LevelTelemetryChannel",
    "LevelTelemetryFrame",
    "OscilloscopeTelemetryFrame",
    "SpectrogramTelemetryFrame",
    "SpectrumTelemetryFrame",
    "StereoTelemetryFrame",
    "StateError",
    "Stream",
    "TelemetryFrame",
    "ValidationError",
    "__version__",
    "import_legacy_preset",
    *_generated_all,
]

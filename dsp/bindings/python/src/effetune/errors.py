"""Public exception categories for EffeTune."""


class EffeTuneError(Exception):
    """Base class for all public EffeTune errors."""


class ValidationError(EffeTuneError, ValueError):
    """Input data or a semantic document is invalid."""


class EffectError(EffeTuneError):
    """An effect type is unknown or unavailable."""


class AssetError(EffeTuneError):
    """A required external asset is missing or malformed."""


class EffeTuneRuntimeError(EffeTuneError, RuntimeError):
    """The native DSP runtime could not prepare or process audio."""


class StateError(EffeTuneError, RuntimeError):
    """An operation is invalid for the current wrapper lifecycle."""


__all__ = [
    "AssetError",
    "EffectError",
    "EffeTuneError",
    "EffeTuneRuntimeError",
    "StateError",
    "ValidationError",
]

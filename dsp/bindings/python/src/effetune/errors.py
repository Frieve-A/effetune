"""Public exception categories for EffeTune."""


class EffeTuneError(Exception):
    """Base class for all public EffeTune errors."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        path: str | None = None,
        node_id: str | None = None,
        edge_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.path = path
        self.node_id = node_id
        self.edge_id = edge_id


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


_VALIDATION_DETAIL = "_effetune_validation_detail"


def set_validation_detail(
    error: EffeTuneError, kind: str, parameter: str | None = None
) -> EffeTuneError:
    """Tag a validation failure with its machine-readable cause.

    Chain validation reports a human-readable message; Graph document normalization
    needs to know whether the channel, a parameter, or the effect type was rejected so
    it can point at the right document location. The tag is an extra attribute, so no
    existing message, class, or behaviour changes.
    """
    if getattr(error, _VALIDATION_DETAIL, None) is None:
        setattr(error, _VALIDATION_DETAIL, {"kind": kind, "parameter": parameter})
    return error


def validation_detail(error: BaseException) -> dict[str, str | None] | None:
    return getattr(error, _VALIDATION_DETAIL, None)


__all__ = [
    "AssetError",
    "EffectError",
    "EffeTuneError",
    "EffeTuneRuntimeError",
    "StateError",
    "ValidationError",
]

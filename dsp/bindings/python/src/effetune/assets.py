"""Validated impulse-response assets and resolver helpers."""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from numbers import Integral, Real
from typing import Any, TypeAlias

import numpy as np

from .errors import AssetError

MAX_ASSET_BYTES = 32 * 1024 * 1024
TOPOLOGIES = frozenset(("automatic", "mono", "independent", "trueStereo", "matrix"))


@dataclass(frozen=True)
class ConvolutionPath:
    """One explicit matrix convolution route."""

    input_slot: int
    output_slot: int
    ir_channel: int


@dataclass(frozen=True)
class AssetData:
    """A finite planar float32 impulse response."""

    samples: np.ndarray
    sample_rate: int
    kind: str = "impulseResponse"
    topology: str = "automatic"
    paths: tuple[ConvolutionPath, ...] = ()
    input_count: int | None = None

    def __post_init__(self) -> None:
        samples = self.samples
        if not isinstance(samples, np.ndarray):
            raise AssetError("impulse-response samples must be a numpy.ndarray")
        if samples.dtype != np.float32 or samples.ndim != 2 or not samples.flags.c_contiguous:
            raise AssetError(
                "impulse-response samples must be C-contiguous planar float32 data"
            )
        if samples.shape[0] < 1 or samples.shape[0] > 8 or samples.shape[1] < 1:
            raise AssetError("impulse-response shape must be (1..8 channels, frames)")
        if samples.nbytes > MAX_ASSET_BYTES:
            raise AssetError("impulse-response sample data exceeds the 32 MiB asset limit")
        if not np.isfinite(samples).all():
            raise AssetError("impulse-response samples must all be finite")
        if (
            isinstance(self.sample_rate, bool)
            or not isinstance(self.sample_rate, Integral)
            or int(self.sample_rate) <= 0
        ):
            raise AssetError("impulse-response sample_rate must be a positive integer")
        if self.kind != "impulseResponse":
            raise AssetError("asset kind must be 'impulseResponse'")
        if self.topology not in TOPOLOGIES:
            raise AssetError(
                "asset topology must be automatic, mono, independent, trueStereo, or matrix"
            )
        paths = tuple(_coerce_path(path) for path in self.paths)
        object.__setattr__(self, "paths", paths)
        if self.topology == "matrix":
            if not paths or len(paths) > 8:
                raise AssetError("matrix topology requires between 1 and 8 convolution paths")
            if (
                isinstance(self.input_count, bool)
                or not isinstance(self.input_count, Integral)
                or not 1 <= int(self.input_count) <= 8
            ):
                raise AssetError("matrix topology requires input_count from 1 to 8")
            for path in paths:
                if path.input_slot >= int(self.input_count):
                    raise AssetError("matrix path input_slot exceeds input_count")
                if path.ir_channel >= samples.shape[0]:
                    raise AssetError("matrix path ir_channel exceeds asset channels")
            input_slots = {path.input_slot for path in paths}
            if input_slots != set(range(int(self.input_count))):
                raise AssetError(
                    "matrix path input_slot values must form a contiguous range "
                    "starting at 0"
                )
        elif paths or self.input_count is not None:
            raise AssetError("paths and input_count are only valid for matrix topology")


AssetResolver: TypeAlias = Callable[[str], AssetData | Mapping[str, Any] | None]


def _coerce_path(value: Any) -> ConvolutionPath:
    if isinstance(value, ConvolutionPath):
        result = value
    elif isinstance(value, Mapping):
        try:
            result = ConvolutionPath(
                input_slot=value["inputSlot"],
                output_slot=value["outputSlot"],
                ir_channel=value["irChannel"],
            )
        except (KeyError, TypeError) as error:
            raise AssetError(
                "matrix paths require inputSlot, outputSlot, and irChannel"
            ) from error
        if set(value) != {"inputSlot", "outputSlot", "irChannel"}:
            raise AssetError("matrix paths contain unknown fields")
    elif isinstance(value, Sequence) and len(value) == 3:
        result = ConvolutionPath(value[0], value[1], value[2])
    else:
        raise AssetError("invalid matrix convolution path")
    for name, item in (
        ("input_slot", result.input_slot),
        ("output_slot", result.output_slot),
        ("ir_channel", result.ir_channel),
    ):
        if isinstance(item, bool) or not isinstance(item, Integral) or not 0 <= int(item) <= 7:
            raise AssetError(f"matrix path {name} must be an integer from 0 to 7")
    return ConvolutionPath(
        int(result.input_slot), int(result.output_slot), int(result.ir_channel)
    )


def coerce_asset_data(value: Any) -> AssetData:
    """Validate a resolver result without accepting implicit audio decoding."""
    if isinstance(value, AssetData):
        return AssetData(
            samples=_snapshot_samples(value.samples),
            sample_rate=value.sample_rate,
            kind=value.kind,
            topology=value.topology,
            paths=value.paths,
            input_count=value.input_count,
        )
    if not isinstance(value, Mapping):
        raise AssetError("asset resolver must return AssetData or an asset data object")
    unknown = sorted(
        set(value) - {"samples", "sampleRate", "sample_rate", "kind", "topology", "paths", "inputCount"}
    )
    if unknown:
        raise AssetError(f"asset data contains unknown fields: {', '.join(unknown)}")
    try:
        samples = value["samples"]
        sample_rate = value.get("sampleRate", value.get("sample_rate"))
    except KeyError as error:
        raise AssetError("asset data requires samples and sampleRate") from error
    if sample_rate is None:
        raise AssetError("asset data requires samples and sampleRate")
    return AssetData(
        samples=_snapshot_samples(samples),
        sample_rate=sample_rate,
        kind=value.get("kind", "impulseResponse"),
        topology=value.get("topology", "automatic"),
        paths=tuple(value.get("paths", ())),
        input_count=value.get("inputCount"),
    )


def _snapshot_samples(samples: Any) -> Any:
    if not isinstance(samples, np.ndarray):
        return samples
    if samples.nbytes > MAX_ASSET_BYTES:
        raise AssetError("impulse-response sample data exceeds the 32 MiB asset limit")
    return np.array(samples, copy=True, order="C", subok=False)


def resolve_asset(reference: str, resolver: AssetResolver | None, effect_label: str) -> AssetData:
    if resolver is None:
        raise AssetError(
            f"{effect_label} requires impulse-response asset {reference!r}, "
            "but no asset_resolver was provided"
        )
    try:
        value = resolver(reference)
    except AssetError:
        raise
    except Exception as error:
        raise AssetError(
            f"{effect_label} could not resolve impulse-response asset {reference!r}"
        ) from error
    if value is None:
        raise AssetError(
            f"{effect_label} could not resolve impulse-response asset {reference!r}"
        )
    try:
        return coerce_asset_data(value)
    except AssetError as error:
        raise AssetError(f"{effect_label} asset {reference!r}: {error}") from error


def asset_sha256(samples: np.ndarray) -> str:
    little_endian = np.asarray(samples, dtype="<f4", order="C")
    return hashlib.sha256(little_endian.tobytes(order="C")).hexdigest()


def resolve_topology(asset: AssetData, processing_channels: int, requested: str) -> str:
    topology = requested if requested != "automatic" else asset.topology
    if topology == "automatic":
        if asset.samples.shape[0] == 1:
            topology = "mono"
        elif asset.samples.shape[0] == processing_channels:
            topology = "independent"
        elif asset.samples.shape[0] == 4 and processing_channels == 2:
            topology = "trueStereo"
        else:
            raise AssetError(
                "automatic IR topology is ambiguous for this asset and processing channel count"
            )
    if asset.topology not in ("automatic", topology):
        raise AssetError(
            f"asset topology {asset.topology!r} conflicts with effect channelMode {requested!r}"
        )
    channels = asset.samples.shape[0]
    if topology == "mono" and channels != 1:
        raise AssetError("mono IR topology requires exactly one asset channel")
    if topology == "independent" and channels != processing_channels:
        raise AssetError("independent IR topology requires one asset channel per audio channel")
    if topology == "trueStereo" and (channels != 4 or processing_channels != 2):
        raise AssetError("trueStereo IR topology requires four IR channels and stereo audio")
    if topology == "matrix":
        if not asset.paths or asset.input_count is None:
            raise AssetError("matrix IR topology requires explicit paths and input_count")
        if asset.input_count > processing_channels:
            raise AssetError(
                "matrix IR topology uses more input slots than processing channels"
            )
        for path in asset.paths:
            if path.output_slot >= processing_channels:
                raise AssetError("matrix path output_slot exceeds processing channels")
    return topology


def resolve_room_eq_topology(asset: AssetData, processing_channels: int) -> str:
    """Resolve the shared or per-channel filter layout supported by Room EQ."""
    topology = resolve_topology(asset, processing_channels, "automatic")
    if topology not in ("mono", "independent"):
        raise AssetError(
            "RoomEQ requires either one shared filter channel or one filter channel "
            "per processing channel"
        )
    return topology


def resolve_rate_divider(asset_rate: int, processing_rate: float, requested: str) -> int:
    requested_divider = {"full": 1, "half": 2, "quarter": 4}.get(requested)
    candidates = (requested_divider,) if requested_divider is not None else (1, 2, 4)
    for divider in candidates:
        if divider is not None and abs(processing_rate / divider - asset_rate) < 0.5:
            return divider
    raise AssetError(
        "IR sample rate must equal the processing rate selected by convolutionRate; "
        "the Python wrapper does not resample assets"
    )


__all__ = [
    "AssetData",
    "AssetResolver",
    "ConvolutionPath",
    "MAX_ASSET_BYTES",
    "asset_sha256",
]

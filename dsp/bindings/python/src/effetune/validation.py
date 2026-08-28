"""Validation and private parameter packing for the semantic API."""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Mapping, Sequence
from numbers import Integral, Real
from typing import Any

import numpy as np

from .errors import AssetError, EffectError, ValidationError, set_validation_detail

UINT32_MAX = (1 << 32) - 1
MAX_BLOCK_SIZE = 16_384
CHANNELS = frozenset(
    (
        "all",
        "stereo",
        "left",
        "right",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16",
        "34",
        "56",
        "78",
        "910",
        "1112",
        "1314",
        "1516",
    )
)


def _catalog() -> tuple[dict[str, Any], dict[str, type]]:
    from ._generated_effects import EFFECT_CLASSES, EFFECT_METADATA

    return (
        {entry["type"]: entry for entry in EFFECT_METADATA["effects"]},
        EFFECT_CLASSES,
    )


def effect_metadata(effect_type: str) -> dict[str, Any]:
    if not isinstance(effect_type, str):
        raise set_validation_detail(EffectError("effect type must be a string"), "type")
    metadata, _ = _catalog()
    try:
        return metadata[effect_type]
    except KeyError as error:
        raise set_validation_detail(
            EffectError(f"unsupported effect type: {effect_type}"), "type"
        ) from error


def validate_seed(seed: Any) -> int:
    if isinstance(seed, bool) or not isinstance(seed, Integral):
        raise ValidationError("seed must be an integer from 0 to 4294967295")
    value = int(seed)
    if value < 0 or value > UINT32_MAX:
        raise ValidationError("seed must be an integer from 0 to 4294967295")
    return value


def _as_float(value: Any) -> float | None:
    """Convert a number to a double, or report that a double cannot hold it.

    JSON puts no bound on an integer literal, so a preset file the caller did not author
    can carry an integer with more digits than a double can represent. float() and
    math.isfinite() raise OverflowError for those, which would escape the EffeTuneError
    taxonomy, so the conversion is reported as a missing result and every call site turns
    it into the message it already uses for a number it cannot accept.
    """
    try:
        return float(value)
    except (OverflowError, ValueError):
        return None


def validate_sample_rate(sample_rate: Any) -> float:
    if isinstance(sample_rate, bool) or not isinstance(sample_rate, Real):
        raise ValidationError("sample_rate must be a positive finite number")
    value = _as_float(sample_rate)
    if (
        value is None
        or not math.isfinite(value)
        or value <= 0.0
        or value > np.finfo(np.float32).max
    ):
        raise ValidationError("sample_rate must be a positive finite number")
    return value


def validate_positive_integer(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral) or int(value) <= 0:
        raise ValidationError(f"{name} must be a positive integer")
    return int(value)


def validate_block_size(value: Any) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, Integral)
        or not 1 <= int(value) <= MAX_BLOCK_SIZE
    ):
        raise ValidationError("block_size must be an integer from 1 to 16384")
    return int(value)


def validate_audio(
    audio: Any,
    *,
    channels: int | None = None,
    maximum_frames: int | None = None,
) -> np.ndarray:
    if not isinstance(audio, np.ndarray):
        raise ValidationError("audio must be a numpy.ndarray")
    if audio.dtype != np.float32:
        raise ValidationError("audio dtype must be float32")
    if audio.ndim != 2:
        raise ValidationError("audio shape must be (channels, frames)")
    if not audio.flags.c_contiguous:
        raise ValidationError(
            "audio must be C-contiguous planar data; frame-direction slices such as "
            "audio[:, start:stop] are non-contiguous views, so pass "
            "np.ascontiguousarray(block)"
        )
    if audio.shape[0] < 1 or audio.shape[1] < 1:
        raise ValidationError("audio must contain at least one channel and one frame")
    if audio.shape[0] > 16:
        if audio.shape[1] <= 16:
            raise ValidationError(
                "audio supports at most 16 channels; if this data is shaped "
                "(frames, channels), use "
                "np.ascontiguousarray(audio.T, dtype=np.float32)"
            )
        raise ValidationError("audio supports at most 16 channels")
    if channels is not None and audio.shape[0] != channels:
        raise ValidationError(f"audio must contain exactly {channels} channels")
    if maximum_frames is not None and audio.shape[1] > maximum_frames:
        raise ValidationError(f"audio block exceeds the stream block_size of {maximum_frames}")
    if not np.isfinite(audio).all():
        raise ValidationError("audio samples must all be finite")
    return audio


def _validate_scalar(definition: Mapping[str, Any], value: Any, name: str) -> Any:
    kind = definition["type"]
    if kind == "boolean":
        if not isinstance(value, (bool, np.bool_)):
            raise ValidationError(f"{name} must be a boolean")
        return bool(value)
    if kind == "string":
        if not isinstance(value, str):
            raise ValidationError(f"{name} must be a string")
        if "values" in definition and value not in definition["values"]:
            values = ", ".join(repr(item) for item in definition.get("values", ()))
            raise ValidationError(f"{name} must be one of: {values}")
        if len(value) > definition.get("maximumLength", math.inf):
            raise ValidationError(
                f"{name} must contain at most {definition['maximumLength']} characters"
            )
        if "pattern" in definition and re.fullmatch(definition["pattern"], value) is None:
            example = definition.get("default")
            hint = f" (for example {example!r})" if isinstance(example, str) else ""
            raise ValidationError(
                f"{name} has an invalid format; expected a string matching "
                f"{definition['pattern']}{hint}"
            )
        return value
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise ValidationError(f"{name} must be a finite number")
    number = _as_float(value)
    if number is None or not math.isfinite(number):
        raise ValidationError(f"{name} must be a finite number")
    if kind == "integer" and not number.is_integer():
        raise ValidationError(f"{name} must be an integer")
    if "values" in definition and value not in definition["values"]:
        values = ", ".join(repr(item) for item in definition["values"])
        raise ValidationError(f"{name} must be one of: {values}")
    if number < definition.get("minimum", -math.inf) or number > definition.get(
        "maximum", math.inf
    ):
        lower = definition.get("minimum", "-inf")
        upper = definition.get("maximum", "inf")
        raise ValidationError(f"{name} must be between {lower} and {upper}")
    return int(number) if kind == "integer" else number


def validate_parameters(effect_type: str, parameters: Mapping[str, Any] | None) -> dict[str, Any]:
    metadata = effect_metadata(effect_type)
    if parameters is None:
        source: Mapping[str, Any] = {}
    elif isinstance(parameters, Mapping):
        source = parameters
    else:
        raise ValidationError(f"{effect_type}.parameters must be an object")
    definitions = {entry["name"]: entry for entry in metadata["parameters"]}
    unknown = sorted(set(source) - set(definitions))
    if unknown:
        raise set_validation_detail(
            ValidationError(
                f"{effect_type}.parameters contains unknown fields: {', '.join(unknown)}"
            ),
            "parameter",
            unknown[0],
        )
    result: dict[str, Any] = {}
    for name, definition in definitions.items():
        value = source[name] if name in source else copy.deepcopy(definition["default"])
        count = int(definition.get("count", 1))
        try:
            if count == 1:
                result[name] = _validate_scalar(definition, value, f"{effect_type}.{name}")
                continue
            if (
                isinstance(value, (str, bytes, bytearray))
                or not isinstance(value, Sequence)
                or len(value) != count
            ):
                raise ValidationError(
                    f"{effect_type}.{name} must contain exactly {count} values"
                )
            result[name] = tuple(
                _validate_scalar(definition, item, f"{effect_type}.{name}[{index}]")
                for index, item in enumerate(value)
            )
        except ValidationError as error:
            set_validation_detail(error, "parameter", name)
            raise
    return result


def validate_assets(
    effect_type: str, assets: Mapping[str, str] | None
) -> dict[str, str]:
    metadata = effect_metadata(effect_type)
    definitions = {entry["name"]: entry for entry in metadata.get("assets", ())}
    source: Mapping[str, Any]
    if assets is None:
        source = {}
    elif isinstance(assets, Mapping):
        source = assets
    else:
        raise set_validation_detail(
            AssetError(f"{effect_type}.assets must be an object"), "assets"
        )
    unknown = sorted(set(source) - set(definitions))
    if unknown:
        raise set_validation_detail(
            AssetError(
                f"{effect_type}.assets contains unknown fields: {', '.join(unknown)}"
            ),
            "assets",
        )
    missing = sorted(name for name in definitions if name not in source)
    if missing:
        raise set_validation_detail(
            AssetError(
                f"{effect_type}.assets is missing required fields: {', '.join(missing)}"
            ),
            "assets",
        )
    result: dict[str, str] = {}
    for name, value in source.items():
        if not isinstance(value, str) or not value or len(value) > 128:
            raise set_validation_detail(
                AssetError(
                    f"{effect_type}.assets.{name} must be a non-empty string"
                ),
                "assets",
            )
        result[name] = value
    return result


def validate_effect_options(
    effect_type: str,
    *,
    parameters: Mapping[str, Any] | None,
    id: str | None,
    enabled: Any,
    channel: Any,
    assets: Mapping[str, str] | None,
) -> tuple[dict[str, Any], str | None, bool, str, dict[str, str]]:
    if id is not None and (not isinstance(id, str) or not id or len(id) > 128):
        raise ValidationError("effect id must be a non-empty string of at most 128 characters")
    if not isinstance(enabled, bool):
        raise ValidationError("effect enabled must be a boolean")
    if not isinstance(channel, str) or channel not in CHANNELS:
        values = ", ".join(sorted(CHANNELS))
        raise set_validation_detail(
            ValidationError(f"effect channel must be one of: {values}"), "channel"
        )
    return (
        validate_parameters(effect_type, parameters),
        id,
        enabled,
        channel,
        validate_assets(effect_type, assets),
    )


def _encode_internal(value: Any, definition: Mapping[str, Any]) -> float:
    if definition["type"] == "boolean":
        return 1.0 if value else 0.0
    if definition["type"] == "string":
        return float(definition["values"].index(value))
    return float(value)


def _transform(value: Any, rule: Mapping[str, Any], definition: Mapping[str, Any]) -> float:
    kind = rule["kind"]
    if kind == "identity":
        return _encode_internal(value, definition)
    if kind == "naturalLog":
        return math.log(float(value))
    if kind == "log10":
        return math.log10(float(value))
    if kind == "decibelsFromReference":
        return 20.0 * math.log10(float(value) / float(rule["reference"]))
    if kind == "map":
        for index, entry in enumerate(rule["values"]):
            if entry["public"] == value:
                internal = entry["internal"]
                if isinstance(internal, (int, float)) and not isinstance(internal, bool):
                    return float(internal)
                return float(index)
        raise ValidationError(f"cannot pack unsupported value {value!r}")
    raise EffeTuneRuntimeError(f"unsupported generated transform: {kind}")


def pack_parameters(effect: Any) -> tuple[np.ndarray, int, str]:
    metadata = effect_metadata(effect.effect_type)
    definitions = {entry["name"]: entry for entry in metadata["parameters"]}
    from ._generated_effects import _EFFECT_IMPLEMENTATION

    implementation = _EFFECT_IMPLEMENTATION[effect.effect_type]
    packed = np.empty(int(implementation["floatCount"]), dtype=np.float32)
    for entry in implementation["packedParameters"]:
        value = effect.parameters[entry["publicName"]]
        values = value if entry["count"] != 1 else (value,)
        definition = definitions[entry["publicName"]]
        for index, item in enumerate(values):
            packed[entry["offset"] + index] = _transform(
                item, entry["transform"], definition
            )
    return (
        np.ascontiguousarray(packed),
        int(implementation["layoutHash"]),
        str(implementation["internalType"]),
    )


def pack_parameter_bytes(effect: Any) -> np.ndarray | None:
    from ._generated_effects import _EFFECT_IMPLEMENTATION

    implementation = _EFFECT_IMPLEMENTATION[effect.effect_type]
    structured = implementation.get("structuredParameter")
    if structured is None:
        return None
    if structured["codec"] != "matrix-routes-v1":
        raise EffeTuneRuntimeError(
            f"unsupported generated structured parameter codec: {structured['codec']}"
        )

    source = effect.parameters[structured["publicName"]]
    routes: list[tuple[int, int, int]] = []
    offset = 0
    while offset < len(source):
        phase = 0
        if source[offset] == "p":
            phase = 1
            offset += 1
        if offset + 1 >= len(source):
            break
        input_text = source[offset]
        output_text = source[offset + 1]
        if input_text in "0123456789abcdef" and output_text in "0123456789abcdef":
            if len(routes) >= int(structured["maxItems"]):
                raise ValidationError(
                    f"{effect.effect_type}.{structured['publicName']} contains too many routes"
                )
            routes.append((int(input_text, 16), int(output_text, 16), phase))
        offset += 2

    packed = np.empty(4 + len(routes) * 3, dtype=np.uint8)
    packed[0] = 1
    packed[1] = 0
    packed[2] = len(routes) & 0xFF
    packed[3] = len(routes) >> 8
    for index, route in enumerate(routes):
        packed[4 + index * 3 : 7 + index * 3] = route
    return np.ascontiguousarray(packed)


def validate_chain_document(document: Any, *, entry_label: str | None = None) -> list[Any]:
    if not isinstance(document, Mapping):
        raise ValidationError("chain document must be an object")
    unknown = sorted(set(document) - {"version", "chain"})
    if unknown:
        raise ValidationError(f"chain document contains unknown fields: {', '.join(unknown)}")
    if isinstance(document.get("version"), bool) or document.get("version") != 1:
        raise ValidationError("chain document version must be 1")
    nodes = document.get("chain")
    if not isinstance(nodes, list):
        raise ValidationError("chain document chain must be an array")
    from ._base import Effect

    effects: list[Effect] = []
    explicit_ids: set[str] = set()
    for index, node in enumerate(nodes):
        label = entry_label or f"chain[{index}]"
        if not isinstance(node, Mapping):
            raise ValidationError(f"{label} must be an object")
        unknown_node = sorted(
            set(node) - {"id", "type", "enabled", "channel", "parameters", "assets"}
        )
        if unknown_node:
            raise ValidationError(
                f"{label} contains unknown fields: {', '.join(unknown_node)}"
            )
        if "type" not in node or "parameters" not in node:
            raise ValidationError(f"{label} requires type and parameters")
        effect = Effect(
            node["type"],
            parameters=node["parameters"],
            id=node.get("id"),
            enabled=node.get("enabled", True),
            channel=node.get("channel", "all"),
            assets=node.get("assets"),
        )
        if effect.id is not None:
            if effect.id in explicit_ids:
                raise ValidationError(f"duplicate effect id: {effect.id}")
            explicit_ids.add(effect.id)
        effects.append(effect)
    return effects


from .errors import EffeTuneRuntimeError  # noqa: E402

__all__ = [
    "CHANNELS",
    "effect_metadata",
    "pack_parameter_bytes",
    "pack_parameters",
    "validate_assets",
    "validate_audio",
    "validate_block_size",
    "validate_chain_document",
    "validate_effect_options",
    "validate_positive_integer",
    "validate_sample_rate",
    "validate_seed",
]

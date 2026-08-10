"""Semantic preset loading and explicit legacy conversion."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
import math
from pathlib import Path
from typing import Any

from .errors import EffectError, ValidationError
from .validation import _as_float, effect_metadata, validate_chain_document


def read_json_source(source: Any) -> Any:
    if isinstance(source, Mapping) or isinstance(source, list):
        return source
    if isinstance(source, Path):
        try:
            return json.loads(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValidationError(f"could not read JSON document: {source}") from error
    if not isinstance(source, str):
        raise ValidationError("preset must be a document, path, or JSON string")
    if source.lstrip().startswith(("{", "[")):
        try:
            return json.loads(source)
        except json.JSONDecodeError as error:
            raise ValidationError("preset JSON is invalid") from error
    path = Path(source)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"could not read JSON document: {path}") from error


_LEGACY_ENVELOPE_KEYS_V1 = ("pipeline", "plugins")

_SHORT_FORMAT_GUIDANCE_V1 = (
    "short-format presets shared through the EffeTune app's URL or clipboard are "
    "not supported. Export a .effetune_preset file (long format) from the app and "
    "import that instead."
)


def _reject_short_format(label: str) -> None:
    raise ValidationError(f"{label} uses short-format keys (nm/en); {_SHORT_FORMAT_GUIDANCE_V1}")


def load_preset_document(source: Any) -> dict[str, Any]:
    document = read_json_source(source)
    if isinstance(document, Mapping):
        envelopes = [key for key in _LEGACY_ENVELOPE_KEYS_V1 if key in document]
        if envelopes:
            raise ValidationError(
                f"preset contains the EffeTune app preset field(s): {', '.join(envelopes)}; "
                "this is an app preset rather than a semantic chain document. "
                "Import it with Chain.from_legacy_preset()."
            )
    effects = validate_chain_document(document)
    return {"version": 1, "chain": [effect.to_dict() for effect in effects]}


@dataclass(frozen=True)
class LegacyImportReport:
    """Information intentionally discarded while flattening a legacy preset."""

    warnings: tuple[str, ...] = ()


# App display names whose alphanumeric normalization cannot reach the semantic type
# or the internal type (leading digits instead of spelled-out numbers). Keys are the
# exact display names produced by the app's plugin constructors; the JavaScript
# binding keeps the same table in dsp/bindings/js/src/preset.js and both are pinned
# to dsp/bindings/common/legacy-app-export-v1.fixture.json.
_LEGACY_EFFECT_ALIASES_V1 = {
    "5Band PEQ": "FiveBandPEQ",
    "15Band GEQ": "FifteenBandGEQ",
    "15Band PEQ": "FifteenBandPEQ",
    "5Band Dynamic EQ": "FiveBandDynamicEQ",
    "5Band FIR PEQ": "FiveBandFIRPEQ",
}


def _normalized_name(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise EffectError("legacy effect name must be a non-empty string")
    return "".join(character.lower() for character in value if character.isalnum()).removesuffix(
        "plugin"
    )


def _effect_type(value: Any) -> str:
    from ._generated_effects import EFFECT_METADATA

    requested = _normalized_name(value)
    if value in _LEGACY_EFFECT_ALIASES_V1:
        return _LEGACY_EFFECT_ALIASES_V1[value]
    from ._generated_effects import _EFFECT_IMPLEMENTATION

    for metadata in EFFECT_METADATA["effects"]:
        candidates = (
            metadata["type"],
            _EFFECT_IMPLEMENTATION[metadata["type"]]["internalType"],
        )
        if requested in {_normalized_name(candidate) for candidate in candidates}:
            return metadata["type"]
    raise EffectError(f"unsupported legacy effect: {value}")


# Legacy channel spellings the EffeTune app can write. The app's
# js/utils/serialization-utils.js normalizeChannel accepts 'All'/'Left'/'Right'
# and the empty string alongside the normalized 'A'/'L'/'R' aliases, so real old
# presets contain them. This table mirrors the JavaScript binding's legacyChannel
# in dsp/bindings/js/src/preset.js exactly: same accepted input set, same results.
_LEGACY_CHANNEL_ALIASES_V1 = {
    "A": "all",
    "All": "all",
    "all": "all",
    "L": "left",
    "Left": "left",
    "left": "left",
    "R": "right",
    "Right": "right",
    "right": "right",
    "stereo": "stereo",
}

_LEGACY_CHANNEL_NUMBERS_V1 = ("1", "2", "3", "4", "5", "6", "7", "8", "34", "56", "78")


def _legacy_channel(value: Any) -> str:
    if value is None or value == "":
        return "stereo"
    if not isinstance(value, str):
        raise ValidationError(f"unsupported legacy channel routing: {value!r}")
    normalized = _LEGACY_CHANNEL_ALIASES_V1.get(value, value)
    if normalized in _LEGACY_CHANNEL_NUMBERS_V1:
        return normalized
    if normalized in ("all", "stereo", "left", "right"):
        return normalized
    raise ValidationError(f"unsupported legacy channel routing: {value!r}")


# The app's serializer copies structural values into the parameters object it
# exports: plugin-base.js getSerializableParameters() re-emits the assigned channel
# and bus indexes under their short names, and a few plugins add their class name
# under `pluginType`. Every one of them duplicates a value the surrounding node
# already carries, which stays the source of truth, so they are dropped instead of
# being reported as unknown parameters. The JavaScript binding keeps the same table
# in dsp/bindings/js/src/preset.js.
_LEGACY_ECHOED_STRUCTURAL_KEYS_V1 = ("pluginType", "ch", "ib", "ob")

# Horn Resonator and Horn Resonator Plus additionally echo the node's enabled switch
# into their parameters. Unlike Modal Resonator's `en` -- an independent processing
# switch the importer folds into `enabled` -- it is a plain duplicate, so it is
# dropped for these two effects only.
_LEGACY_ECHOED_ENABLED_EFFECTS_V1 = ("HornResonator", "HornResonatorPlus")

# These analyzers persist their frequency-axis choice for display only. Validate
# the known values before discarding it so other unknown parameters remain strict.
_LEGACY_FREQUENCY_SCALE_EFFECTS_V1 = ("SpectrumAnalyzer", "Spectrogram")


def _drop_echoed_structural_keys_v1(
    parameters: dict[str, Any], effect_type: str
) -> dict[str, Any]:
    for key in _LEGACY_ECHOED_STRUCTURAL_KEYS_V1:
        parameters.pop(key, None)
    if effect_type in _LEGACY_ECHOED_ENABLED_EFFECTS_V1:
        parameters.pop("en", None)
    return parameters


def _expand_legacy_object_array_v1(
    parameters: dict[str, Any],
    *,
    effect_label: str,
    array_key: str,
    count: int,
    members: Mapping[str, str],
    item_label: str = "band",
    allow_meter_state: bool = False,
) -> bool:
    if array_key not in parameters:
        return False
    values = parameters.pop(array_key)
    if not isinstance(values, list) or len(values) != count:
        raise ValidationError(
            f"legacy {effect_label} must contain exactly {count} {item_label} settings"
        )
    if any(
        public_name in parameters for public_name in members.values()
    ):
        raise ValidationError(
            f"legacy {effect_label} supplies the same {item_label} settings "
            "more than once"
        )
    expanded = {public_name: [] for public_name in members.values()}
    discarded_meter_state = False
    required = set(members)
    allowed = required | ({"gr"} if allow_meter_state else set())
    for value in values:
        if not isinstance(value, Mapping) or set(value) - allowed or required - set(value):
            raise ValidationError(
                f"legacy {effect_label} contains unsupported or incomplete "
                f"{item_label} settings"
            )
        for legacy_name, public_name in members.items():
            expanded[public_name].append(value[legacy_name])
        if "gr" in value:
            meter_value = value["gr"]
            meter_number = (
                None
                if isinstance(meter_value, bool)
                or not isinstance(meter_value, (int, float))
                else _as_float(meter_value)
            )
            if meter_number is None or not math.isfinite(meter_number):
                raise ValidationError(
                    f"legacy {effect_label} contains invalid meter display state"
                )
            discarded_meter_state = True
    parameters.update(expanded)
    return discarded_meter_state


def _expand_legacy_short_key_arrays_v1(
    parameters: dict[str, Any],
    *,
    effect_label: str,
    members: Mapping[str, str],
    item_label: str = "channel",
) -> None:
    """Rename the app's whole-array short keys onto their public parameter names.

    A few effects store a fixed-length per-channel setting as one short key holding
    the whole array instead of the numbered keys every other effect uses. The array
    length itself is checked by the shared chain-document validation. The JavaScript
    binding keeps the same table in dsp/bindings/js/src/preset.js.
    """
    for legacy_name, public_name in members.items():
        if legacy_name not in parameters:
            continue
        if public_name in parameters:
            raise ValidationError(
                f"legacy {effect_label} supplies the same {item_label} settings "
                "more than once"
            )
        values = parameters.pop(legacy_name)
        if not isinstance(values, list):
            raise ValidationError(
                f"legacy {effect_label} contains unsupported or incomplete "
                f"{item_label} settings"
            )
        parameters[public_name] = values


def _prepare_legacy_parameters_v1(
    effect_type: str,
    source: Mapping[str, Any],
    warnings: list[str],
) -> tuple[dict[str, Any], bool]:
    parameters = _drop_echoed_structural_keys_v1(dict(source), effect_type)
    if effect_type in _LEGACY_FREQUENCY_SCALE_EFFECTS_V1 and "sc" in parameters:
        scale = parameters.pop("sc")
        if scale not in ("log", "linear"):
            raise ValidationError(
                f"legacy {effect_type} contains invalid frequency scale display state"
            )
    processing_enabled = True
    if effect_type == "Matrix" and "mx" in parameters:
        if "matrixRoutes" in parameters:
            raise ValidationError(
                "legacy Matrix supplies routing settings more than once"
            )
        parameters["matrixRoutes"] = parameters.pop("mx")
    elif effect_type == "MultibandCompressor":
        discarded = _expand_legacy_object_array_v1(
            parameters,
            effect_label="Multiband Compressor",
            array_key="bands",
            count=5,
            members={
                "t": "threshold",
                "r": "ratio",
                "a": "attack",
                "rl": "release",
                "k": "knee",
                "g": "gain",
            },
            allow_meter_state=True,
        )
        if discarded:
            warnings.append("discarded legacy compressor meter display state")
    elif effect_type == "MultibandExpander":
        _expand_legacy_object_array_v1(
            parameters,
            effect_label="Multiband Expander",
            array_key="bands",
            count=5,
            members={
                "t": "threshold",
                "r": "ratio",
                "a": "attack",
                "rl": "release",
                "k": "knee",
                "g": "gain",
            },
        )
    elif effect_type == "MultibandTransient":
        _expand_legacy_object_array_v1(
            parameters,
            effect_label="Multiband Transient",
            array_key="bands",
            count=3,
            members={
                "fa": "fastAttack",
                "fr": "fastRelease",
                "sa": "slowAttack",
                "sr": "slowRelease",
                "gt": "transientGain",
                "gs": "sustainGain",
                "sm": "gainSmoothing",
            },
        )
    elif effect_type == "MultibandBalance":
        _expand_legacy_object_array_v1(
            parameters,
            effect_label="Multiband Balance",
            array_key="bands",
            count=5,
            members={"balance": "balance"},
        )
    elif effect_type == "MultiChannelPanel":
        _expand_legacy_short_key_arrays_v1(
            parameters,
            effect_label="MultiChannel Panel",
            members={
                "m": "mute",
                "s": "solo",
                "v": "volume",
                "d": "delay",
                "l": "link",
            },
        )
    elif effect_type == "MultibandSaturation":
        _expand_legacy_object_array_v1(
            parameters,
            effect_label="Multiband Saturation",
            array_key="bands",
            count=3,
            members={
                "dr": "drive",
                "bs": "bias",
                "mx": "mix",
                "gn": "gain",
            },
        )
    elif effect_type == "FiveBandDynamicEQ":
        _expand_legacy_object_array_v1(
            parameters,
            effect_label="5Band Dynamic EQ",
            array_key="bs",
            count=5,
            members={
                "en": "enabledBands",
                "ft": "filterType",
                "f": "frequency",
                "q": "q",
                "mg": "maxGain",
                "th": "threshold",
                "r": "ratio",
                "kn": "knee",
                "a": "attack",
                "rl": "release",
                "scf": "sidechainFrequency",
                "scq": "sidechainQ",
            },
        )
    elif effect_type == "ModalResonator":
        _expand_legacy_object_array_v1(
            parameters,
            effect_label="Modal Resonator",
            array_key="rs",
            count=5,
            members={
                "en": "resonatorEnabled",
                "fr": "frequencyLog",
                "dc": "decay",
                "lp": "lowPassLog",
                "hp": "highPassLog",
                "gn": "gain",
            },
            item_label="resonator",
        )
        if "en" in parameters:
            processing_enabled = parameters.pop("en")
            if not isinstance(processing_enabled, bool):
                raise ValidationError(
                    "legacy Modal Resonator processing state must be a boolean"
                )
        if "sr" in parameters:
            selection = parameters.pop("sr")
            if (
                isinstance(selection, bool)
                or not isinstance(selection, int)
                or not 0 <= selection < 5
            ):
                raise ValidationError(
                    "legacy Modal Resonator editor selection must be an integer from 0 to 4"
                )
            warnings.append("discarded legacy Modal Resonator editor selection")
    return parameters, processing_enabled


def _reject_asset_backed_legacy_effect_v1(effect_type: str) -> None:
    """Reject app presets for effects the library drives from a precomputed asset.

    These effects replace the app's filter-design parameters with an impulse response
    supplied by the caller, so an app export carries nothing convertible: reporting the
    app's parameters as unsupported fields would read like a typo report instead of the
    structural limit it is. The set is derived from the generated catalog's required
    assets rather than a second hardcoded table. The JavaScript binding keeps the same
    rule in dsp/bindings/js/src/preset.js -- same error type, same message -- and both
    are pinned to dsp/bindings/common/legacy-app-export-v1.fixture.json.
    """
    assets = effect_metadata(effect_type).get("assets") or ()
    if not any(asset.get("required") for asset in assets):
        return
    raise EffectError(
        f"{effect_type} cannot be imported from an EffeTune app preset: in the DSP "
        "library this effect is driven by a precomputed impulse-response asset, and "
        "the app's filter-design parameters cannot be converted. Construct the effect "
        "directly and supply its impulse-response asset instead."
    )


def _legacy_parameters(effect_type: str, source: Mapping[str, Any]) -> dict[str, Any]:
    metadata = effect_metadata(effect_type)
    definitions = {entry["name"]: entry for entry in metadata["parameters"]}
    from ._generated_effects import _EFFECT_IMPLEMENTATION

    packed = _EFFECT_IMPLEMENTATION[effect_type]["packedParameters"]
    remaining = dict(source)
    result: dict[str, Any] = {}
    structured = _EFFECT_IMPLEMENTATION[effect_type].get("structuredParameter")
    if structured and structured["publicName"] in remaining:
        name = structured["publicName"]
        result[name] = remaining.pop(name)
    for entry in packed:
        name = entry["publicName"]
        keys = entry["keys"]
        if name in remaining:
            result[name] = remaining.pop(name)
            continue
        present = [key in remaining for key in keys]
        if any(present) and not all(present):
            raise ValidationError(
                f"legacy {effect_type}.{name} supplies only part of its fixed-length array"
            )
        if all(present):
            values = [remaining.pop(key) for key in keys]
            transform = entry["transform"]
            kind = transform["kind"]
            if kind in ("naturalLog", "log10", "decibelsFromReference"):
                # These inverse transforms are arithmetic, and import_legacy_preset()
                # reads files the caller did not author, so a value the arithmetic cannot
                # take has to be reported instead of leaking the TypeError or
                # OverflowError it would raise. The JavaScript binding carries the same
                # guard in reverseTransform (dsp/bindings/js/src/preset.js), because its
                # own coercion would otherwise turn null, true or [] into a number
                # silently.
                for value in values:
                    if isinstance(value, bool) or not isinstance(value, (int, float)):
                        raise ValidationError(
                            f"legacy {effect_type}.{name} contains a non-numeric value"
                        )
                    number = _as_float(value)
                    if number is None:
                        raise ValidationError(
                            f"legacy {effect_type}.{name} contains an out-of-range value"
                        )
                    if not math.isfinite(number):
                        raise ValidationError(
                            f"legacy {effect_type}.{name} contains a non-finite value"
                        )
                # A value on the wrong scale -- a frequency in Hz where the app stores its
                # logarithm, say -- overflows the exponentiation. Python reports that as
                # OverflowError (or as an integer too large to be a parameter), while the
                # JavaScript binding produces Infinity and its parameter validation
                # rejects it; both bindings have to report the same kind of failure.
                try:
                    if kind == "naturalLog":
                        converted = [math.exp(value) for value in values]
                    elif kind == "log10":
                        converted = [10**value for value in values]
                    else:
                        reference = transform["reference"]
                        converted = [reference * (10 ** (value / 20)) for value in values]
                    overflowed = not all(math.isfinite(value) for value in converted)
                except OverflowError:
                    overflowed = True
                if overflowed:
                    raise ValidationError(
                        f"legacy {effect_type}.{name} contains an out-of-range value"
                    )
                values = converted
            elif kind == "map":
                mapped = []
                for value in values:
                    match = next(
                        (
                            candidate["public"]
                            for candidate in transform["values"]
                            if candidate["internal"] == value
                        ),
                        None,
                    )
                    if match is None:
                        raise ValidationError(
                            f"legacy {effect_type}.{name} contains an unmapped value"
                        )
                    mapped.append(match)
                values = mapped
            elif kind != "identity":
                raise ValidationError(
                    f"legacy {effect_type}.{name} uses an unsupported transform"
                )
            result[name] = values[0] if entry["count"] == 1 else values
    if remaining:
        raise ValidationError(
            f"legacy {effect_type} contains unsupported fields: {', '.join(sorted(remaining))}"
        )
    for name, definition in definitions.items():
        if name not in result:
            result[name] = definition["default"]
    return result


def import_legacy_preset(source: Any) -> tuple[dict[str, Any], LegacyImportReport]:
    """Convert a recognized app preset without guessing unsupported semantics."""
    document = read_json_source(source)
    if isinstance(document, list):
        # The app still loads a preset file whose top level is a bare array of
        # long-format entries as the pipeline (js/electron/presetIntegration.js and
        # js/app.js), so files in that shape exist in the wild. A bare array of
        # short-format entries keeps the existing guidance instead. The first entry
        # that is an object decides, exactly like the JavaScript binding.
        first = next((node for node in document if isinstance(node, Mapping)), None)
        if first is not None and "nm" in first and "name" not in first:
            _reject_short_format("legacy preset")
        document = {"pipeline": document}
    if not isinstance(document, Mapping):
        raise ValidationError("legacy preset must be an object")
    has_pipeline = isinstance(document.get("pipeline"), list)
    has_plugins = isinstance(document.get("plugins"), list)
    if has_pipeline == has_plugins:
        raise ValidationError("legacy preset must contain exactly pipeline or plugins")
    allowed_top = {"name", "timestamp", "pipeline" if has_pipeline else "plugins"}
    unknown_top = sorted(set(document) - allowed_top)
    if unknown_top:
        raise ValidationError(
            f"legacy preset contains unsupported fields: {', '.join(unknown_top)}"
        )
    if has_pipeline:
        envelope = "pipeline"
        nodes = document["pipeline"]
    else:
        envelope = "plugins"
        nodes = document["plugins"]

    result: list[dict[str, Any]] = []
    discarded = [name for name in ("name", "timestamp") if name in document]
    warnings = [f"discarded legacy preset metadata: {', '.join(discarded)}"] if discarded else []
    section_enabled = True
    for index, node in enumerate(nodes):
        if not isinstance(node, Mapping):
            raise ValidationError(f"legacy {envelope}[{index}] must be an object")
        if envelope == "pipeline" and "nm" in node and "name" not in node:
            _reject_short_format(f"legacy pipeline[{index}]")
        name_key = "name" if envelope == "pipeline" else "nm"
        enabled_key = "enabled" if envelope == "pipeline" else "en"
        name = node.get(name_key)
        input_bus = node.get("inputBus" if envelope == "pipeline" else "ib", 0)
        output_bus = node.get("outputBus" if envelope == "pipeline" else "ob", 0)
        if input_bus != 0 or output_bus != 0:
            raise ValidationError(
                "This preset uses multiple audio paths. "
                "Only presets with one serial effect chain are supported."
            )
        if _normalized_name(name) == "section":
            # The node-level field check stays aligned with the non-Section path below
            # and with the JavaScript binding: the long form carries the same structural
            # fields every other node does (`id` included), and the short form carries
            # the keys the app echoes into the node it serializes.
            allowed = {
                name_key,
                enabled_key,
                "comment",
                "cm",
                "inputBus" if envelope == "pipeline" else "ib",
                "outputBus" if envelope == "pipeline" else "ob",
                "channel" if envelope == "pipeline" else "ch",
                *(
                    {"id", "parameters"}
                    if envelope == "pipeline"
                    else set(_LEGACY_ECHOED_STRUCTURAL_KEYS_V1)
                ),
            }
            unknown = sorted(set(node) - allowed)
            if unknown:
                raise ValidationError(
                    f"legacy Section contains unsupported fields: {', '.join(unknown)}"
                )
            enabled = node.get(enabled_key, True)
            if not isinstance(enabled, bool):
                raise ValidationError("legacy Section enabled must be a boolean")
            parameters = node.get("parameters", {}) if envelope == "pipeline" else node
            if not isinstance(parameters, Mapping):
                raise ValidationError("legacy Section parameters must be an object")
            structural = (
                set()
                if envelope == "pipeline"
                else {name_key, enabled_key, "ib", "ob", "ch"}
            )
            unknown_parameters = sorted(
                key
                for key in parameters
                if key not in structural
                and key not in {"comment", "cm"}
                and key not in _LEGACY_ECHOED_STRUCTURAL_KEYS_V1
            )
            if unknown_parameters:
                raise ValidationError(
                    "legacy Section contains unsupported parameters: "
                    + ", ".join(unknown_parameters)
                )
            section_enabled = enabled
            warnings.append(f"flattened legacy Section at index {index}")
            continue

        effect_type = _effect_type(name)
        _reject_asset_backed_legacy_effect_v1(effect_type)
        enabled = node.get(enabled_key, True)
        if not isinstance(enabled, bool):
            raise ValidationError(f"legacy {effect_type} enabled must be a boolean")
        channel_key = "channel" if envelope == "pipeline" else "ch"
        channel = _legacy_channel(node.get(channel_key))
        if envelope == "pipeline":
            allowed = {
                "id",
                name_key,
                enabled_key,
                channel_key,
                "inputBus",
                "outputBus",
                "parameters",
            }
            unknown = sorted(set(node) - allowed)
            if unknown:
                raise ValidationError(
                    f"legacy {effect_type} contains unsupported fields: {', '.join(unknown)}"
                )
            parameters = node.get("parameters", {})
            if not isinstance(parameters, Mapping):
                raise ValidationError(f"legacy {effect_type}.parameters must be an object")
        else:
            structural = {name_key, enabled_key, channel_key, "ib", "ob"}
            parameters = {key: value for key, value in node.items() if key not in structural}
        parameters, processing_enabled = _prepare_legacy_parameters_v1(
            effect_type, parameters, warnings
        )
        result.append(
            {
                **({"id": node["id"]} if envelope == "pipeline" and "id" in node else {}),
                "type": effect_type,
                "enabled": enabled and section_enabled and processing_enabled,
                "channel": channel,
                "parameters": _legacy_parameters(effect_type, parameters),
            }
        )
    canonical = {"version": 1, "chain": result}
    effects = validate_chain_document(canonical)
    return (
        {"version": 1, "chain": [effect.to_dict() for effect in effects]},
        LegacyImportReport(tuple(warnings)),
    )


__all__ = [
    "LegacyImportReport",
    "import_legacy_preset",
    "load_preset_document",
    "read_json_source",
]

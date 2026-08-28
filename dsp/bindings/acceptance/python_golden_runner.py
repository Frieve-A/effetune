"""Run the frozen wrapper golden matrix through the installed Python package."""

from __future__ import annotations

import argparse
import inspect
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np


MASK_64 = (1 << 64) - 1
DEFAULT_NOISE_SEED = 0xEFFE7A5E


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def frozen_golden_child(
    directory: Path, name: Any, label: str, seen: set[str]
) -> Path:
    if (
        not isinstance(name, str)
        or not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
        or Path(name).is_absolute()
        or name in seen
    ):
        raise RuntimeError(f"invalid or duplicate frozen golden {label}: {name!r}")
    seen.add(name)
    root = directory.resolve(strict=True)
    candidate = (directory / name).resolve(strict=True)
    if candidate.parent != root:
        raise RuntimeError(f"frozen golden {label} must be a direct child: {name}")
    return candidate


def discover_cases(repo_root: Path) -> list[dict[str, Any]]:
    private = read_json(
        repo_root / "dsp" / "bindings" / "generated" / "effects-v1.private.json"
    )
    public = read_json(
        repo_root / "dsp" / "bindings" / "generated" / "effects-v1.json"
    )
    public_by_type = {entry["type"]: entry for entry in public["effects"]}
    frozen_sources = private.get("frozenGoldenIndexes", {})
    if (
        not isinstance(frozen_sources, dict)
        or len(frozen_sources) != len(private["effects"])
    ):
        raise RuntimeError(
            "frozen golden source mapping does not match the effect inventory"
        )
    frozen_paths = list(frozen_sources.values())
    if len(set(frozen_paths)) != len(frozen_paths):
        raise RuntimeError("frozen golden source mapping contains a duplicate path")
    golden_by_type: dict[str, Path] = {}
    for source_name, golden_name in frozen_sources.items():
        source_path = Path(source_name)
        golden_path = Path(golden_name)
        expected = source_path.parent / "golden" / "index.json"
        if (
            golden_path != expected
            or golden_path.is_absolute()
            or ".." in golden_path.parts
        ):
            raise RuntimeError(f"invalid frozen golden path for {source_name}")
        index_path = repo_root / golden_path
        index = read_json(index_path)
        if index["type"] in golden_by_type:
            raise RuntimeError(f"duplicate frozen golden index for {index['type']}")
        golden_by_type[index["type"]] = index_path

    cases: list[dict[str, Any]] = []
    for public_type, implementation in private["effects"].items():
        internal_type = implementation["internalType"]
        index_path = golden_by_type.get(internal_type)
        if index_path is None:
            raise RuntimeError(f"missing golden index for {internal_type}")
        index = read_json(index_path)
        if not isinstance(index.get("cases"), list):
            raise RuntimeError(
                f"frozen golden index cases must be an array for {internal_type}"
            )
        metadata_names: set[str] = set()
        binary_names: set[str] = set()
        for filename in index["cases"]:
            metadata_path = frozen_golden_child(
                index_path.parent, filename, "metadata path", metadata_names
            )
            metadata = read_json(metadata_path)
            reference_path = frozen_golden_child(
                index_path.parent,
                metadata.get("binary"),
                "binary path",
                binary_names,
            )
            cases.append(
                {
                    "publicType": public_type,
                    "implementation": implementation,
                    "definition": public_by_type[public_type],
                    "metadataPath": metadata_path,
                    "referencePath": reference_path,
                    "metadata": metadata,
                }
            )
    return cases


def xorshift64(state: int) -> int:
    state ^= (state << 13) & MASK_64
    state ^= state >> 7
    state ^= (state << 17) & MASK_64
    return state & MASK_64


def generate_stimulus(metadata: dict[str, Any]) -> np.ndarray:
    stimulus = metadata["stimulus"]
    sample_rate = metadata["sampleRate"]
    frames = metadata["frameCount"]
    channels = metadata["channels"]
    case_index = metadata["caseIndex"]
    output = np.zeros((channels, frames), dtype=np.float32)
    if stimulus == "silence":
        return output
    if stimulus == "imp":
        output[:, 0] = 1.0
        for channel in range(channels):
            staggered = 1000 + channel
            if staggered < frames:
                output[channel, staggered] = 1.0
        return output
    if stimulus == "noise":
        state = DEFAULT_NOISE_SEED ^ case_index
        if state == 0:
            state = DEFAULT_NOISE_SEED
        flat = output.reshape(-1)
        for index in range(flat.size):
            state = xorshift64(state)
            value = float(state >> 11) / float(2**53)
            flat[index] = value * 2.0 - 1.0
        return output

    minus_six_db = 10 ** (-6 / 20)
    minus_twelve_db = 10 ** (-12 / 20)
    minus_three_db = 10 ** (-3 / 20)
    for channel in range(channels):
        for frame in range(frames):
            if stimulus == "sin1k":
                value = math.sin(2 * math.pi * 1000 * frame / sample_rate) * minus_six_db
            elif stimulus == "sweep":
                duration = frames / sample_rate
                start_hz = 20
                end_hz = min(20000, sample_rate * 0.45)
                rate = math.log(end_hz / start_hz) / duration
                seconds = frame / sample_rate
                phase = 2 * math.pi * start_hz * math.expm1(rate * seconds) / rate
                value = math.sin(phase) * minus_twelve_db
            elif stimulus == "sq50":
                value = (
                    minus_three_db
                    if math.sin(2 * math.pi * 50 * frame / sample_rate) >= 0
                    else -minus_three_db
                )
            elif stimulus == "fs":
                value = 1.0 if ((frame + channel) & 1) == 0 else -1.0
            elif stimulus == "step":
                value = 0.0 if frame < frames // 2 else 0.5
            else:
                raise RuntimeError(f"unknown stimulus {stimulus}")
            output[channel, frame] = value
    return output


def reverse_transform(rule: dict[str, Any], value: Any) -> Any:
    kind = rule["kind"]
    if kind == "identity":
        return value
    if kind == "naturalLog":
        return math.exp(float(value))
    if kind == "log10":
        return 10 ** float(value)
    if kind == "decibelsFromReference":
        return float(rule["reference"]) * (10 ** (float(value) / 20))
    if kind == "map":
        for entry in rule["values"]:
            if entry["internal"] == value:
                return entry["public"]
        raise RuntimeError(f"no public mapping for internal value {value!r}")
    raise RuntimeError(f"unsupported transform {kind}")


def semantic_parameters(case: dict[str, Any], legacy: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for packed in case["implementation"]["packedParameters"]:
        keys = packed["keys"]
        definition = next(
            (
                parameter
                for parameter in case["definition"]["parameters"]
                if parameter["name"] == packed["publicName"]
            ),
            None,
        )
        if definition is None:
            raise RuntimeError(
                f"public metadata is missing {packed['publicName']}"
            )
        values: list[Any] | None = None
        if all(key in legacy for key in keys):
            values = [
                reverse_transform(packed["transform"], legacy[key])
                for key in keys
            ]
        else:
            prefixes = {re.sub(r"[0-9]+$", "", key) for key in keys}
            array_key = next(iter(prefixes)) if len(prefixes) == 1 else None
            aggregate = legacy.get(array_key) if array_key is not None else None
            if (
                packed["count"] > 1
                and isinstance(aggregate, list)
                and 0 < len(aggregate) <= packed["count"]
            ):
                values = [
                    reverse_transform(packed["transform"], aggregate[index])
                    if index < len(aggregate)
                    else definition["default"][index]
                    if isinstance(definition["default"], list)
                    else definition["default"]
                    for index in range(packed["count"])
                ]
            if values is None and packed["count"] > 1 and array_key:
                object_array = next(
                    (
                        value
                        for value in legacy.values()
                        if isinstance(value, list)
                        and 0 < len(value) <= packed["count"]
                        and all(isinstance(item, dict) for item in value)
                        and any(array_key in item for item in value)
                    ),
                    None,
                )
                if object_array is not None:
                    default = definition["default"]
                    values = [
                        reverse_transform(
                            packed["transform"], object_array[index][array_key]
                        )
                        if index < len(object_array)
                        and array_key in object_array[index]
                        else default[index] if isinstance(default, list) else default
                        for index in range(packed["count"])
                    ]
        if values is None:
            default = definition["default"]
            values = list(default) if isinstance(default, list) else [default]
        result[packed["publicName"]] = values[0] if packed["count"] == 1 else values
    structured = case["implementation"].get("structuredParameter")
    if structured is not None:
        definition = next(
            (
                parameter
                for parameter in case["definition"]["parameters"]
                if parameter["name"] == structured["publicName"]
            ),
            None,
        )
        if definition is None:
            raise RuntimeError(
                f"public metadata is missing {structured['publicName']}"
            )
        result[structured["publicName"]] = legacy.get(
            structured["key"], definition["default"]
        )
    return result


def supplied_semantic_names(
    case: dict[str, Any], supplied: dict[str, Any]
) -> list[str]:
    names: list[str] = []
    for legacy_name, supplied_value in supplied.items():
        for packed in case["implementation"]["packedParameters"]:
            keys = packed["keys"]
            prefixes = {re.sub(r"[0-9]+$", "", key) for key in keys}
            array_key = next(iter(prefixes)) if len(prefixes) == 1 else None
            aggregate = (
                packed["count"] > 1
                and array_key is not None
                and array_key == legacy_name
            )
            object_array = (
                packed["count"] > 1
                and array_key is not None
                and isinstance(supplied_value, list)
                and any(
                    isinstance(item, dict) and array_key in item
                    for item in supplied_value
                )
            )
            if (
                legacy_name in keys or aggregate or object_array
            ) and packed["publicName"] not in names:
                names.append(packed["publicName"])
        structured = case["implementation"].get("structuredParameter")
        if (
            structured is not None
            and structured["key"] == legacy_name
            and structured["publicName"] not in names
        ):
            names.append(structured["publicName"])
    return names


def semantic_event_parameters(
    case: dict[str, Any], current: dict[str, Any], supplied: dict[str, Any]
) -> dict[str, Any]:
    snapshot = semantic_parameters(case, current)
    return {
        name: snapshot[name]
        for name in supplied_semantic_names(case, supplied)
    }


def expected_validation_rejection(case: dict[str, Any]) -> dict[str, str] | None:
    parameters = semantic_parameters(case, case["metadata"]["params"])
    for definition in case["definition"]["parameters"]:
        value = parameters.get(definition["name"])
        pattern = definition.get("pattern")
        if (
            isinstance(value, str)
            and isinstance(pattern, str)
            and re.fullmatch(pattern, value) is None
        ):
            return {
                "parameter": definition["name"],
                "reason": "pattern-mismatch",
            }
    return None


def synthetic_ir(asset: dict[str, Any], sample_rate: int) -> np.ndarray:
    spec = asset["ir"]
    if spec.get("kind") != "sparse-decay-v1":
        raise RuntimeError("unsupported synthetic IR kind")
    tap_count = int(spec.get("tapCount", 17))
    state = int(spec.get("seed", 0x49525631)) & 0xFFFFFFFF
    if state == 0:
        state = 0x49525631

    def next_u32() -> int:
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state

    samples = np.zeros((asset["channels"], asset["frames"]), dtype=np.float32)
    for channel in range(asset["channels"]):
        channel_gain = 1.0 - channel * 0.12
        samples[channel, 0] = float(spec.get("directGain", 0.7)) * channel_gain
        for tap in range(1, tap_count):
            frame = 1 + next_u32() % max(1, asset["frames"] - 1)
            sign = 1.0 if (next_u32() & 1) == 0 else -1.0
            decay = math.exp(-4 * frame / asset["frames"])
            increment = (
                sign
                * float(spec.get("tailGain", 0.45))
                * channel_gain
                * decay
                / math.sqrt(tap + 1)
            )
            samples[channel, frame] = np.float32(
                float(samples[channel, frame]) + increment
            )
        if asset["frames"] > 1:
            increment = float(spec.get("tailGain", 0.45)) * channel_gain * 0.01
            samples[channel, -1] = np.float32(float(samples[channel, -1]) + increment)
    expected_rate = round(sample_rate / asset["rateDivider"])
    if expected_rate <= 0:
        raise RuntimeError("invalid synthetic IR rate")
    return samples


def make_chain(effetune: Any, case: dict[str, Any]) -> tuple[Any, Any]:
    metadata = case["metadata"]
    parameters = semantic_parameters(case, metadata["params"])
    node: dict[str, Any] = {
        "id": "golden-effect",
        "type": case["publicType"],
        "enabled": True,
        "channel": "all",
        "parameters": parameters,
    }
    resolver = None
    if "asset" in metadata:
        asset = metadata["asset"]
        samples = synthetic_ir(asset, metadata["sampleRate"])
        topology_names = {
            1: "mono",
            2: "independent",
            3: "trueStereo",
            4: "matrix",
        }
        paths = tuple(
            effetune.ConvolutionPath(
                path["input"], path["output"], path["irChannel"]
            )
            for path in asset.get("paths", ())
        )
        data = effetune.AssetData(
            samples=samples,
            sample_rate=round(metadata["sampleRate"] / asset["rateDivider"]),
            topology=topology_names[asset["topology"]],
            paths=paths,
            input_count=asset.get("inputCount"),
        )
        node["assets"] = {"impulseResponse": "golden-ir"}
        resolver = lambda reference: data if reference == "golden-ir" else None
    return effetune.Chain.from_preset({"version": 1, "chain": [node]}, asset_resolver=resolver), resolver


def compare_spectral(
    expected: np.ndarray,
    observed: np.ndarray,
    tolerance: dict[str, Any],
    channels: int,
    frames: int,
) -> dict[str, Any]:
    requested_size = int(tolerance.get("fftSize", 16_384))
    maximum_size = min(frames, requested_size)
    fft_size = 1 << (maximum_size.bit_length() - 1) if maximum_size >= 2 else 0
    if fft_size < 2:
        raise RuntimeError("spectral comparison needs at least two frames")
    db_limit = float(tolerance.get("db", tolerance.get("spectralDb", 1)))
    floor_db = float(tolerance.get("floorDb", -160))
    window = np.hanning(fft_size)
    scale = 2.0 / max(1, fft_size - 1)
    max_db_error = 0.0
    squared_error = 0.0
    compared_bins = 0
    first_offending_bin = -1
    first_offending_channel = -1
    failure_count = 0
    for channel in range(channels):
        offset = channel * frames
        expected_magnitude = np.abs(
            np.fft.rfft(expected[offset : offset + fft_size] * window)
        ) * scale
        observed_magnitude = np.abs(
            np.fft.rfft(observed[offset : offset + fft_size] * window)
        ) * scale
        expected_db = np.maximum(
            floor_db, 20.0 * np.log10(np.maximum(expected_magnitude, 1e-24))
        )
        observed_db = np.maximum(
            floor_db, 20.0 * np.log10(np.maximum(observed_magnitude, 1e-24))
        )
        errors = np.abs(observed_db - expected_db)
        max_db_error = max(max_db_error, float(errors.max(initial=0)))
        squared_error += float(np.sum(errors * errors))
        compared_bins += int(errors.size)
        failed = np.flatnonzero(errors > db_limit)
        failure_count += int(failed.size)
        if first_offending_bin == -1 and failed.size:
            first_offending_bin = int(failed[0])
            first_offending_channel = channel
    return {
        "pass": failure_count == 0,
        "policy": "spectral",
        "dbLimit": db_limit,
        "floorDb": floor_db,
        "fftSize": fft_size,
        "maxDbError": max_db_error,
        "rmsDbError": math.sqrt(squared_error / max(1, compared_bins)),
        "firstOffendingBin": first_offending_bin,
        "firstOffendingChannel": first_offending_channel,
        "failureCount": failure_count,
        "comparedBins": compared_bins,
    }


def compare(reference: np.ndarray, actual: np.ndarray, tolerance: dict[str, Any]) -> dict[str, Any]:
    policy = tolerance.get("policy", tolerance.get("parity", "per-sample"))
    if policy not in {"per-sample", "spectral"}:
        raise RuntimeError(f"unknown parity tolerance policy {policy!r}")
    channels = int(actual.shape[0]) if actual.ndim == 2 else 1
    frames = int(actual.shape[1]) if actual.ndim == 2 else int(actual.size)
    expected = reference.reshape(-1)
    observed = actual.reshape(-1)
    if expected.size != observed.size:
        return {
            "pass": False,
            "reason": "length-mismatch",
            "expectedLength": int(expected.size),
            "actualLength": int(observed.size),
        }
    invalid_reference = np.flatnonzero(~np.isfinite(expected))
    if invalid_reference.size:
        return {
            "pass": False,
            "reason": "non-finite-reference",
            "firstOffendingIndex": int(invalid_reference[0]),
            "failureCount": int(invalid_reference.size),
            "sampleCount": int(expected.size),
        }
    invalid_actual = np.flatnonzero(~np.isfinite(observed))
    if invalid_actual.size:
        return {
            "pass": False,
            "reason": "non-finite-actual",
            "firstOffendingIndex": int(invalid_actual[0]),
            "failureCount": int(invalid_actual.size),
            "sampleCount": int(observed.size),
        }
    if policy == "spectral":
        return compare_spectral(
            expected.astype(np.float64),
            observed.astype(np.float64),
            tolerance,
            channels,
            frames,
        )
    differences = np.abs(observed.astype(np.float64) - expected.astype(np.float64))
    abs_limit = float(tolerance.get("abs", 0))
    rel_limit = tolerance.get("rel")
    relative = differences / np.maximum(
        np.maximum(np.abs(expected.astype(np.float64)), abs_limit),
        np.finfo(np.float64).eps,
    )
    failed = differences > abs_limit
    if rel_limit is not None:
        failed |= relative > float(rel_limit)
    indexes = np.flatnonzero(failed)
    return {
        "pass": indexes.size == 0,
        "policy": "per-sample",
        "absLimit": abs_limit,
        "relLimit": rel_limit,
        "maxAbsError": float(differences.max(initial=0)),
        "maxRelError": float(relative.max(initial=0)),
        "rmsError": float(math.sqrt(float(np.mean(differences * differences)))),
        "firstOffendingIndex": int(indexes[0]) if indexes.size else -1,
        "failureCount": int(indexes.size),
        "sampleCount": int(expected.size),
    }


def build_events(case: dict[str, Any]) -> list[dict[str, Any]]:
    current = dict(case["metadata"]["params"])
    events: list[dict[str, Any]] = []
    for event in case["metadata"].get("events", ()):
        supplied = event.get("params", {})
        current.update(supplied)
        events.append(
            {
                "frame": event["frame"],
                "effectId": "golden-effect",
                "parameters": semantic_event_parameters(case, current, supplied),
            }
        )
    return events


def process_event_case(
    chain: Any,
    source: np.ndarray,
    metadata: dict[str, Any],
    events: list[dict[str, Any]],
    seed: int,
    resolver: Any,
) -> np.ndarray:
    with chain.stream(
        metadata["sampleRate"],
        channels=metadata["channels"],
        block_size=metadata["blockSize"],
        seed=seed,
        asset_resolver=resolver,
    ) as stream:
        if "events" not in inspect.signature(stream.process).parameters:
            raise NotImplementedError("Stream.process(..., events=...) is unavailable")
        return stream.process(source, events=events)


def run_modulation_cross_field_contract(effetune: Any) -> bool:
    frames = np.arange(512, dtype=np.float32)
    source = np.vstack(
        (
            np.sin(frames * np.float32(0.071)) * np.float32(0.4),
            np.cos(frames * np.float32(0.053)) * np.float32(0.3),
        )
    ).astype(np.float32, copy=False)

    def canonicalize(
        effect_type: str, parameters: dict[str, float]
    ) -> dict[str, float]:
        values = dict(parameters)
        if effect_type == "AutoFilter":
            if values["minimumFrequency"] > values["maximumFrequency"]:
                values["minimumFrequency"], values["maximumFrequency"] = (
                    values["maximumFrequency"],
                    values["minimumFrequency"],
                )
        elif effect_type == "Chorus":
            values["depth"] = min(values["depth"], values["delay"])
        elif values["minimumShift"] > values["maximumShift"]:
            values["minimumShift"], values["maximumShift"] = (
                values["maximumShift"],
                values["minimumShift"],
            )
        return values

    cases = (
        (
            "AutoFilter",
            {"minimum_frequency": 8000, "maximum_frequency": 200},
            {"minimumFrequency": 8000, "maximumFrequency": 200},
            {"minimumFrequency": 200, "maximumFrequency": 8000},
            {"minimumFrequency": 100, "maximumFrequency": 9000},
        ),
        (
            "Chorus",
            {"delay": 0.5, "depth": 20},
            {"delay": 0.5, "depth": 20},
            {"delay": 0.5, "depth": 0.5},
            {"delay": 10, "depth": 0.25},
        ),
        (
            "FrequencyShifter",
            {"minimum_shift": 900, "maximum_shift": 20},
            {"minimumShift": 900, "maximumShift": 20},
            {"minimumShift": 20, "maximumShift": 900},
            {"minimumShift": 10, "maximumShift": 1000},
        ),
    )
    for effect_type, constructor_parameters, supplied, canonical, updates in cases:
        effect_class = getattr(effetune, effect_type)
        effect_id = f"{effect_type}-cross-field"
        named = effetune.Chain(
            [effect_class(id=effect_id, **constructor_parameters)]
        )
        serialized = effetune.Chain.from_preset(
            json.dumps(
                {
                    "version": 1,
                    "chain": [
                        {
                            "id": effect_id,
                            "type": effect_type,
                            "parameters": supplied,
                        }
                    ],
                }
            )
        )
        canonical_chain = effetune.Chain.from_preset(
            {
                "version": 1,
                "chain": [
                    {
                        "id": effect_id,
                        "type": effect_type,
                        "parameters": canonical,
                    }
                ],
            }
        )
        if named.to_dict() != serialized.to_dict():
            return False
        expected = canonical_chain.process(
            source, sample_rate=48_000, block_size=64
        )
        if not np.array_equal(
            named.process(source, sample_rate=48_000, block_size=64), expected
        ):
            return False
        if not np.array_equal(
            serialized.process(source, sample_rate=48_000, block_size=64),
            expected,
        ):
            return False

        entries = list(supplied.items())
        for ordered in (entries, list(reversed(entries))):
            event_chain = effetune.Chain([effect_class(id=effect_id)])
            events = [
                {
                    "frame": 0,
                    "effectId": effect_id,
                    "parameters": {name: value},
                }
                for name, value in ordered
            ]
            with event_chain.stream(
                48_000, channels=2, block_size=64
            ) as stream:
                if not np.array_equal(
                    stream.process(source, events=events), expected
                ):
                    return False

        for names in (list(updates), list(reversed(updates))):
            candidate_chain = effetune.Chain.from_preset(
                {
                    "version": 1,
                    "chain": [
                        {
                            "id": effect_id,
                            "type": effect_type,
                            "parameters": supplied,
                        }
                    ],
                }
            )
            reference_chain = effetune.Chain.from_preset(
                {
                    "version": 1,
                    "chain": [
                        {
                            "id": effect_id,
                            "type": effect_type,
                            "parameters": canonical,
                        }
                    ],
                }
            )
            with candidate_chain.stream(
                48_000, channels=2, block_size=64
            ) as candidate_stream, reference_chain.stream(
                48_000, channels=2, block_size=64
            ) as reference_stream:
                steps = (
                    (names[0], supplied[names[0]]),
                    (names[1], supplied[names[1]]),
                    (names[0], updates[names[0]]),
                    (names[1], updates[names[1]]),
                )
                effective = dict(canonical)
                for name, value in steps:
                    effective = canonicalize(
                        effect_type, {**effective, name: value}
                    )
                    expected_output = reference_stream.process(
                        source,
                        events=[
                            {
                                "frame": 0,
                                "effectId": effect_id,
                                "parameters": effective,
                            }
                        ],
                    )
                    actual_output = candidate_stream.process(
                        source,
                        events=[
                            {
                                "frame": 0,
                                "effectId": effect_id,
                                "parameters": {name: value},
                            }
                        ],
                    )
                    if not np.array_equal(actual_output, expected_output):
                        return False
            if candidate_chain.to_dict()["chain"][0]["parameters"] != (
                serialized.to_dict()["chain"][0]["parameters"]
            ):
                return False
    return True


def run_frequency_shifter_latency_contract(effetune: Any) -> bool:
    chain = effetune.Chain([effetune.FrequencyShifter()])
    for sample_rate, expected in ((48_000, 114), (96_000, 228), (192_000, 456)):
        if chain.latency_samples(sample_rate, channels=2) != expected:
            return False
        with chain.stream(sample_rate, channels=2, block_size=64) as stream:
            if stream.latency_samples != expected:
                return False
    return True


def run_state_contracts(effetune: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    source = np.full((1, 257), 0.25, dtype=np.float32)
    chain = effetune.Chain(
        [effetune.SimpleJitter(rms_jitter_nanoseconds=100_000)]
    )
    first = chain(source, 48_000, seed=1234, block_size=63)
    second = chain(source, 48_000, seed=1234, block_size=63)
    other = chain(source, 48_000, seed=4321, block_size=63)
    result["sameSeed"] = bool(np.array_equal(first, second))
    result["differentSeed"] = bool(not np.array_equal(first, other))

    impulse = np.zeros((1, 128), dtype=np.float32)
    impulse[0, 0] = 1.0
    delay = effetune.Chain(
        [effetune.Delay(delay_size=1, feedback=80, mix=100, pre_delay=0)]
    )
    stream = delay.stream(48_000, channels=1, block_size=128)
    initial = stream.process(impulse)
    stream.process(np.zeros_like(impulse))
    stream.reset()
    replay = stream.process(impulse)
    result["reset"] = bool(np.array_equal(initial, replay))
    stream.close()
    stream.close()
    result["closeIdempotent"] = bool(stream.closed)
    try:
        stream.process(impulse)
        result["closedRejects"] = False
    except effetune.StateError:
        result["closedRejects"] = True
    result["modulationCrossField"] = run_modulation_cross_field_contract(effetune)
    result["frequencyShifterLatency"] = run_frequency_shifter_latency_contract(
        effetune
    )
    return result


def run_graph_contracts(effetune: Any, repo_root: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    serial_document = {
        "version": 1,
        "input": {"id": "input"},
        "output": {"id": "output"},
        "nodes": [
            {"id": "level", "type": "Volume", "parameters": {"volume": -6}}
        ],
        "edges": [
            {"id": "in", "source": "input", "destination": "level"},
            {"id": "out", "source": "level", "destination": "output"},
        ],
    }
    block = np.ones((1, 64), dtype=np.float32)
    graph = effetune.Graph.from_dict(serial_document)
    with graph.stream(48_000, channels=1, block_size=64) as stream:
        first = stream.process(block)
        result["serialFirstBlock"] = bool(
            first.shape == block.shape and 0 < first[0, 0] < 1
        )
        stream.set_param("level", "volume", -12)
        updated = stream.process(block)
        result["serialUpdate"] = bool(0 < updated[0, 0] < first[0, 0])
        stream.reset()
        replay = stream.process(block)
        result["serialReset"] = bool(np.allclose(first, replay, rtol=0, atol=1e-6))
        visualization = stream.visualization_snapshot()
        result["serialVisualization"] = bool(
            any(
                node.get("id") == "level" and node.get("state") == "effective"
                for node in visualization["nodes"]
            )
            and len(visualization["edges"]) == 2
        )
    graph.close()

    diamond_document = {
        "version": 1,
        "input": {"id": "input"},
        "output": {"id": "output"},
        "nodes": [
            {"id": "left", "type": "Volume", "parameters": {"volume": 0}},
            {"id": "right", "type": "Volume", "parameters": {"volume": 0}},
        ],
        "edges": [
            {"id": "in-left", "source": "input", "destination": "left"},
            {"id": "in-right", "source": "input", "destination": "right"},
            {"id": "left-out", "source": "left", "destination": "output", "gain": 0.5},
            {"id": "right-out", "source": "right", "destination": "output", "gain": 0.5},
        ],
    }
    diamond = effetune.Graph.from_dict(diamond_document)
    with diamond.stream(48_000, channels=1, block_size=64) as stream:
        mixed = stream.process(block)
        snapshot = stream.compile_snapshot
        result["diamondMix"] = bool(np.allclose(mixed, block, rtol=0, atol=1e-6))
        result["diamondAdcSnapshot"] = bool(
            snapshot["latencySamples"] == 0
            and len(snapshot["edges"]) == 4
            and all(len(edge["fanInCompensation"]) == 1 for edge in snapshot["edges"])
        )
    diamond.close()

    fixture = json.loads(
        (repo_root / "dsp/bindings/common/graph-v1-contract.fixture.json").read_text(
            encoding="utf-8"
        )
    )
    fixture_by_name = {entry["name"]: entry["document"] for entry in fixture["valid"]}
    for name, expected_state in (
        ("muted-input-oscillator", "effective"),
        ("muted-output-oscillator", "dormant"),
        ("disabled-bypass", "disabled-bypass"),
    ):
        candidate = effetune.Graph.from_dict(fixture_by_name[name])
        with candidate.stream(48_000, channels=1, block_size=64) as stream:
            observed = stream.process(np.zeros((1, 64), dtype=np.float32))
            node = next(
                item
                for item in stream.visualization_snapshot()["nodes"]
                if item.get("kind") == "effect"
            )
            result[name] = bool(
                node["state"] == expected_state and np.all(np.isfinite(observed))
            )
        candidate.close()

    asset_resolutions = 0
    asset = effetune.AssetData(
        samples=np.ones((1, 1), dtype=np.float32),
        sample_rate=48_000,
        topology="mono",
    )

    def resolve_graph_asset(reference: str) -> Any:
        nonlocal asset_resolutions
        if reference != "tiny-ir":
            raise RuntimeError("unexpected Graph asset reference")
        asset_resolutions += 1
        return asset

    asset_graph = effetune.Graph.from_dict(
        {
            "version": 1,
            "input": {"id": "input"},
            "output": {"id": "output"},
            "nodes": [
                {
                    "id": "room",
                    "type": "IRReverb",
                    "parameters": {
                        "channelMode": "mono",
                        "latency": 0,
                        "convolutionRate": "full",
                        "wetLevel": 0,
                        "dryLevel": -96,
                        "preDelay": 0,
                    },
                    "assets": {"impulseResponse": "tiny-ir"},
                }
            ],
            "edges": [
                {"id": "in", "source": "input", "destination": "room"},
                {"id": "out", "source": "room", "destination": "output"},
            ],
        },
        asset_resolver=resolve_graph_asset,
    )
    with asset_graph.stream(48_000, channels=1, block_size=64) as stream:
        observed = stream.process(np.ones((1, 64), dtype=np.float32))
        result["assetPrewarm"] = bool(
            asset_resolutions == 1 and np.all(np.isfinite(observed))
        )
    asset_graph.close()
    return result


def _snapshot_contains(expected: Any, actual: Any) -> bool:
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(expected) == len(actual)
            and all(
                _snapshot_contains(expected_value, actual_value)
                for expected_value, actual_value in zip(expected, actual)
            )
        )
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and _snapshot_contains(value, actual[key])
            for key, value in expected.items()
        )
    return expected == actual


def run_graph_parity_contracts(effetune: Any, repo_root: Path) -> dict[str, Any]:
    fixture = json.loads(
        (repo_root / "dsp/bindings/common/graph-v1-parity.fixture.json").read_text(
            encoding="utf-8"
        )
    )
    tolerance = float(fixture["tolerance"]["abs"])
    result: dict[str, Any] = {}
    for case in fixture["cases"]:
        source = np.zeros((case["channels"], case["frames"]), dtype=np.float32)
        if case["input"]["kind"] != "impulse":
            raise RuntimeError(f"unsupported Graph parity input: {case['input']['kind']}")
        for channel, value in enumerate(case["input"]["channelValues"]):
            source[channel, case["input"]["frame"]] = value

        expected = np.zeros_like(source)
        if case["expected"]["audio"]["kind"] != "sparse":
            raise RuntimeError(
                f"unsupported Graph parity output: {case['expected']['audio']['kind']}"
            )
        for point in case["expected"]["audio"]["points"]:
            expected[point["channel"], point["frame"]] = point["value"]

        assets = {
            reference: effetune.AssetData(
                samples=np.asarray(asset["channels"], dtype=np.float32),
                sample_rate=asset["sampleRate"],
                topology=asset["topology"],
            )
            for reference, asset in case.get("assets", {}).items()
        }

        def resolve_asset(reference: str) -> Any:
            if reference not in assets:
                raise RuntimeError(f"unknown Graph parity asset: {reference}")
            return assets[reference]

        graph = effetune.Graph.from_dict(
            case["document"],
            asset_resolver=resolve_asset,
        )
        try:
            with graph.stream(
                case["sampleRate"],
                channels=case["channels"],
                block_size=max(case["blockSplits"]),
                seed=case["seed"],
            ) as stream:
                blocks = []
                offset = 0
                for frames in case["blockSplits"]:
                    blocks.append(
                        stream.process(source[:, offset : offset + frames].copy())
                    )
                    offset += frames
                if offset != case["frames"]:
                    raise RuntimeError(
                        f"Graph parity block splits cover {offset} of {case['frames']} frames"
                    )
                observed = np.concatenate(blocks, axis=1)
                passed = bool(
                    stream.latency_samples == case["expected"]["latencySamples"]
                    and _snapshot_contains(
                        case["expected"]["snapshot"], stream.compile_snapshot
                    )
                    and np.allclose(observed, expected, rtol=0, atol=tolerance)
                )
                if case.get("resetEquality"):
                    stream.reset()
                    replay_blocks = []
                    offset = 0
                    for frames in case["blockSplits"]:
                        replay_blocks.append(
                            stream.process(source[:, offset : offset + frames].copy())
                        )
                        offset += frames
                    replay = np.concatenate(replay_blocks, axis=1)
                    passed = passed and bool(
                        np.allclose(replay, observed, rtol=0, atol=tolerance)
                    )
                result[case["id"]] = passed
        finally:
            graph.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--summary", type=Path)
    arguments = parser.parse_args()
    repo_root = arguments.repo_root.resolve()
    cases = discover_cases(repo_root)

    import effetune

    failures: list[dict[str, Any]] = []
    unexecuted: list[dict[str, Any]] = []
    expected_validation_rejections: list[dict[str, Any]] = []
    residuals = {
        "maxAbsError": 0.0,
        "maxRelError": 0.0,
        "maxRmsError": 0.0,
    }
    passed = 0
    for case in cases:
        metadata = case["metadata"]
        label = f"{case['publicType']}/{metadata['id']}"
        expected_rejection = expected_validation_rejection(case)
        try:
            reference = np.fromfile(case["referencePath"], dtype="<f4")
            if (
                reference.size != metadata["outputFloats"]
                or case["referencePath"].stat().st_size != metadata["byteLength"]
            ):
                raise RuntimeError("golden binary length does not match metadata")
            source = generate_stimulus(metadata)
            chain, resolver = make_chain(effetune, case)
            if expected_rejection is not None:
                failures.append(
                    {
                        "case": label,
                        "reason": "expected-validation-rejection-not-raised",
                        "expectation": expected_rejection,
                    }
                )
                continue
            seed = int(metadata["seed"], 0) & 0xFFFFFFFF
            if metadata.get("events"):
                try:
                    actual = process_event_case(
                        chain, source, metadata, build_events(case), seed, resolver
                    )
                except NotImplementedError as error:
                    unexecuted.append(
                        {
                            "case": label,
                            "reason": "unsupported-parameter-events",
                            "detail": str(error),
                            "eventCount": len(metadata["events"]),
                        }
                    )
                    continue
            else:
                actual = chain.process(
                    source,
                    sample_rate=metadata["sampleRate"],
                    seed=seed,
                    block_size=metadata["blockSize"],
                    asset_resolver=resolver,
                )
            comparison = compare(reference, actual, metadata["tolerance"])
            residuals["maxAbsError"] = max(
                residuals["maxAbsError"], comparison.get("maxAbsError", 0.0)
            )
            residuals["maxRelError"] = max(
                residuals["maxRelError"], comparison.get("maxRelError", 0.0)
            )
            residuals["maxRmsError"] = max(
                residuals["maxRmsError"], comparison.get("rmsError", 0.0)
            )
            if comparison["pass"]:
                passed += 1
            else:
                failures.append({"case": label, "comparison": comparison})
        except Exception as error:
            if (
                expected_rejection is not None
                and isinstance(error, effetune.ValidationError)
            ):
                passed += 1
                expected_validation_rejections.append(
                    {"case": label, **expected_rejection}
                )
            else:
                failures.append(
                    {
                        "case": label,
                        "reason": type(error).__name__,
                        "detail": str(error),
                    }
                )

    state_contracts: dict[str, Any]
    try:
        state_contracts = run_state_contracts(effetune)
    except Exception as error:
        state_contracts = {"error": f"{type(error).__name__}: {error}"}
    try:
        graph_contracts = run_graph_contracts(effetune, repo_root)
    except Exception as error:
        graph_contracts = {"error": f"{type(error).__name__}: {error}"}
    try:
        graph_parity_contracts = run_graph_parity_contracts(effetune, repo_root)
    except Exception as error:
        graph_parity_contracts = {"error": f"{type(error).__name__}: {error}"}
    summary = {
        "backend": "python-native",
        "packageVersion": getattr(effetune, "__version__", "unknown"),
        "counts": {
            "total": len(cases),
            "passed": passed,
            "failed": len(failures),
            "unexecuted": len(unexecuted),
            "expectedValidationRejections": len(
                expected_validation_rejections
            ),
            "assetCases": sum("asset" in case["metadata"] for case in cases),
            "eventCases": sum(bool(case["metadata"].get("events")) for case in cases),
        },
        "residuals": residuals,
        "stateContracts": state_contracts,
        "graphContracts": graph_contracts,
        "graphParityContracts": graph_parity_contracts,
        "expectedValidationRejections": expected_validation_rejections,
        "failures": failures,
        "unexecuted": unexecuted,
    }
    if arguments.summary is not None:
        arguments.summary.parent.mkdir(parents=True, exist_ok=True)
        arguments.summary.write_text(
            json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    contracts_pass = (
        all(value is True for value in state_contracts.values())
        and all(value is True for value in graph_contracts.values())
        and all(value is True for value in graph_parity_contracts.values())
    )
    if failures or unexecuted or not contracts_pass:
        print(
            json.dumps(
                {
                    "failures": failures,
                    "unexecuted": unexecuted,
                    "stateContracts": state_contracts,
                    "graphContracts": graph_contracts,
                    "graphParityContracts": graph_parity_contracts,
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
    print(json.dumps(summary["counts"], separators=(",", ":")))
    return 0 if not failures and not unexecuted and contracts_pass else 1


if __name__ == "__main__":
    sys.exit(main())

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
                and len(aggregate) == packed["count"]
            ):
                values = [
                    reverse_transform(packed["transform"], value)
                    for value in aggregate
                ]
            if values is None and packed["count"] > 1 and array_key:
                object_array = next(
                    (
                        value
                        for value in legacy.values()
                        if isinstance(value, list)
                        and len(value) == packed["count"]
                        and all(isinstance(item, dict) for item in value)
                    ),
                    None,
                )
                if object_array is not None:
                    default = definition["default"]
                    values = [
                        reverse_transform(packed["transform"], item[array_key])
                        if array_key in item
                        else default[index] if isinstance(default, list) else default
                        for index, item in enumerate(object_array)
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
        current.update(event.get("params", {}))
        events.append(
            {
                "frame": event["frame"],
                "effectId": "golden-effect",
                "parameters": semantic_parameters(case, current),
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
        "expectedValidationRejections": expected_validation_rejections,
        "failures": failures,
        "unexecuted": unexecuted,
    }
    if arguments.summary is not None:
        arguments.summary.parent.mkdir(parents=True, exist_ok=True)
        arguments.summary.write_text(
            json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print(json.dumps(summary["counts"], separators=(",", ":")))
    contracts_pass = all(value is True for value in state_contracts.values())
    return 0 if not failures and not unexecuted and contracts_pass else 1


if __name__ == "__main__":
    sys.exit(main())

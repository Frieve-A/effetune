---
layout: dsp
title: "Determinism"
description: "Determinism"
lang: en
permalink: /dsp/concepts/determinism/
---
# Determinism

Repeatability requires the same package version, backend/artifact bytes and digest,
OS/architecture/runtime, Chain, input bytes, sample rate, channel layout, offline or
stream mode, block schedule, execution seed, assets, and complete stream operation
history. Cross-version byte identity is not promised. Backend comparisons use frozen
golden tolerances rather than cross-backend byte identity.

The execution seed defaults to 0 and is an unsigned 32-bit integer. It is distinct from
an effect parameter such as `BitCrusher.seed`, whose catalog default is 11 and range is
0–1000.

## Reproducible experiment

v0.1 has no standard experiment-manifest API. This source owns the complete experiment
record: candidate wheel filename and twice-computed SHA-256, package and environment
versions, input construction and SHA-256, stream mode, parameters, seeds, each ordered
open/process/close operation, exact process block spans, and every output hash. It uses
`SimpleJitter.rmsJitterNanoseconds = 100`, stereo 48 kHz, 4096 frames, 256-frame
blocks, execution seed 0 for identical runs and 1 for the variant. Save the emitted JSON
and pass it back with `--replay-record`; the script reconstructs a new stream from that
record and requires identical input and output digests in the same environment.

```python
import argparse
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path

import numpy as np
import effetune as et

EXPERIMENT = {
    "schemaVersion": 1,
    "effect": "SimpleJitter",
    "parameters": {"rmsJitterNanoseconds": 100},
    "sampleRate": 48_000,
    "channels": 2,
    "frames": 4096,
    "blockSize": 256,
    "processingMode": "stream",
    "executionSeeds": {"same": 0, "different": 1},
    "input": {"kind": "sine", "peak": 0.5, "periodFrames": 97},
}


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def build_input(experiment):
    frames = experiment["frames"]
    source = experiment["input"]
    phase = np.arange(frames, dtype=np.float32)
    mono = (
        source["peak"] * np.sin(2 * np.pi * phase / source["periodFrames"])
    ).astype(np.float32)
    return np.ascontiguousarray(np.stack((mono, mono)))


def operation_history(experiment, seed):
    operations = [{
        "index": 0,
        "operation": "open",
        "mode": experiment["processingMode"],
        "sampleRate": experiment["sampleRate"],
        "channels": experiment["channels"],
        "blockSize": experiment["blockSize"],
        "seed": seed,
    }]
    for start in range(0, experiment["frames"], experiment["blockSize"]):
        operations.append({
            "index": len(operations),
            "operation": "process",
            "startFrame": start,
            "endFrame": min(start + experiment["blockSize"], experiment["frames"]),
        })
    operations.append({
        "index": len(operations),
        "operation": "close",
    })
    return operations


def render_from_history(audio, experiment, operations):
    assert [entry["index"] for entry in operations] == list(range(len(operations)))
    opening = operations[0]
    closing = operations[-1]
    assert opening["operation"] == "open"
    assert opening["mode"] == "stream"
    assert closing["operation"] == "close"
    assert opening["channels"] == audio.shape[0]
    assert opening["sampleRate"] == experiment["sampleRate"]
    assert opening["blockSize"] == experiment["blockSize"]

    cursor = 0
    spans = []
    for operation in operations[1:-1]:
        assert operation["operation"] == "process"
        start = operation["startFrame"]
        end = operation["endFrame"]
        assert start == cursor and start < end <= audio.shape[1]
        spans.append((start, end))
        cursor = end
    assert cursor == audio.shape[1]

    chain = et.Chain([
        et.SimpleJitter(
            rms_jitter_nanoseconds=experiment["parameters"][
                "rmsJitterNanoseconds"
            ]
        )
    ])
    with chain.stream(
        opening["sampleRate"],
        channels=opening["channels"],
        block_size=opening["blockSize"],
        seed=opening["seed"],
    ) as stream:
        blocks = [
            stream.process(np.ascontiguousarray(audio[:, start:end]))
            for start, end in spans
        ]
    return np.concatenate(blocks, axis=1)


def create_record(wheel_path, wheel_sha256):
    audio = build_input(EXPERIMENT)
    runs = []
    outputs = {}
    for label, seed in (
        ("first", EXPERIMENT["executionSeeds"]["same"]),
        ("repeat", EXPERIMENT["executionSeeds"]["same"]),
        ("variant", EXPERIMENT["executionSeeds"]["different"]),
    ):
        operations = operation_history(EXPERIMENT, seed)
        output = render_from_history(audio, EXPERIMENT, operations)
        output_sha256 = digest_bytes(output.tobytes())
        outputs[label] = output
        runs.append({
            "label": label,
            "mode": EXPERIMENT["processingMode"],
            "seed": seed,
            "operations": operations,
            "outputSha256": output_sha256,
        })

    assert outputs["first"].tobytes() == outputs["repeat"].tobytes()
    assert outputs["first"].tobytes() != outputs["variant"].tobytes()
    return {
        "artifact": {
            "filename": wheel_path.name,
            "sha256": wheel_sha256,
        },
        "environment": {
            "effetune": importlib.metadata.version("effetune"),
            "numpy": np.__version__,
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "experiment": EXPERIMENT,
        "input": {
            "dtype": str(audio.dtype),
            "shape": list(audio.shape),
            "sha256": digest_bytes(audio.tobytes()),
        },
        "runs": runs,
        "outputs": {
            run["label"]: run["outputSha256"] for run in runs
        },
    }


def replay_record(record, wheel_path, wheel_sha256):
    assert record["artifact"] == {
        "filename": wheel_path.name,
        "sha256": wheel_sha256,
    }
    experiment = record["experiment"]
    audio = build_input(experiment)
    input_sha256 = digest_bytes(audio.tobytes())
    assert record["input"] == {
        "dtype": str(audio.dtype),
        "shape": list(audio.shape),
        "sha256": input_sha256,
    }
    outputs = {}
    for run in record["runs"]:
        assert run["mode"] == experiment["processingMode"] == "stream"
        assert run["seed"] == run["operations"][0]["seed"]
        output = render_from_history(audio, experiment, run["operations"])
        output_sha256 = digest_bytes(output.tobytes())
        assert output_sha256 == run["outputSha256"]
        outputs[run["label"]] = output_sha256
    assert outputs == record["outputs"]
    return {
        "inputSha256": input_sha256,
        "outputs": outputs,
    }


parser = argparse.ArgumentParser()
parser.add_argument("--wheel", type=Path, required=True)
parser.add_argument("--replay-record", type=Path)
args = parser.parse_args()
wheel_bytes = args.wheel.read_bytes()
first_hash = digest_bytes(wheel_bytes)
second_hash = digest_bytes(args.wheel.read_bytes())
assert first_hash == second_hash

if args.replay_record:
    saved_record = json.loads(args.replay_record.read_text(encoding="utf-8"))
    result = replay_record(saved_record, args.wheel, first_hash)
else:
    result = create_record(args.wheel, first_hash)
print(json.dumps(result, sort_keys=True))
```

```console
python research-experiment.py --wheel /path/to/effetune-0.8.0.whl
```

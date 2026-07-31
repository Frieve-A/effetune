from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from effetune_phase0 import Compressor


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_ROOT = REPOSITORY_ROOT / "dsp" / "plugins" / "dynamics" / "compressor" / "golden"


def full_scale(frames: int, channels: int) -> np.ndarray:
    audio = np.empty((channels, frames), dtype=np.float32)
    for channel in range(channels):
        for frame in range(frames):
            audio[channel, frame] = 1.0 if ((frame + channel) & 1) == 0 else -1.0
    return audio


def main() -> None:
    metadata = json.loads((GOLDEN_ROOT / "case-003.json").read_text(encoding="utf-8"))
    if metadata["stimulus"] != "fs":
        raise AssertionError("Phase 0 verifier expects compressor case-003 to use fs")

    expected = np.fromfile(GOLDEN_ROOT / metadata["binary"], dtype="<f4").reshape(
        metadata["channels"], metadata["frameCount"]
    )
    if not np.isfinite(expected).all():
        raise AssertionError("Python wrapper golden contains non-finite samples")
    input_audio = full_scale(metadata["frameCount"], metadata["channels"])
    tolerance = float(metadata["tolerance"]["abs"])
    maximum_dry_difference = float(np.max(np.abs(input_audio - expected)))
    if maximum_dry_difference <= tolerance:
        raise AssertionError(
            "Python wrapper golden does not distinguish Compressor processing "
            f"from dry input: {maximum_dry_difference} <= {tolerance}"
        )
    params = metadata["params"]
    compressor = Compressor(
        threshold=params["th"],
        ratio=params["rt"],
        attack=params["at"],
        release=params["rl"],
        knee=params["kn"],
        gain=params["gn"],
    )
    actual = compressor.process(
        input_audio,
        sample_rate=metadata["sampleRate"],
        block_size=metadata["blockSize"],
    )
    if actual.shape != expected.shape:
        raise AssertionError(
            f"Python wrapper returned shape {actual.shape}, expected {expected.shape}"
        )
    if not np.isfinite(actual).all():
        raise AssertionError("Python wrapper returned non-finite samples")

    absolute_error = np.abs(actual - expected)
    if not np.isfinite(absolute_error).all():
        raise AssertionError("Python wrapper comparison produced non-finite differences")
    maximum_error = float(np.max(absolute_error))
    if maximum_error > tolerance:
        raise AssertionError(
            f"Python wrapper exceeded abs tolerance: {maximum_error} > {tolerance}"
        )
    print(
        "Python compressor case-003 passed: "
        f"blockSize={metadata['blockSize']}, absTolerance={tolerance:g}, "
        f"maxDryDifference={maximum_dry_difference:g}, maxAbsError={maximum_error:g}"
    )


if __name__ == "__main__":
    main()

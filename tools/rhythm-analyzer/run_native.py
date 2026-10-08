"""Bounded production-input runs for the frozen external scoring protocol.

Lists and outputs contain private per-excerpt data. Keep them outside the
tracked tree. This tool does not read annotations during inference or retune.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import time

import numpy as np
from scipy.signal import resample_poly
import soundfile as sf

import numeric as N


def load_audio(track, rate):
    with sf.SoundFile(track["audio"]) as stream:
        native_rate = stream.samplerate
        stream.seek(round(float(track.get("start", 0.0)) * native_rate))
        frames = round(float(track["dur"]) * native_rate)
        pcm = stream.read(frames, dtype="float32", always_2d=True)
    pcm = pcm[:, :2].mean(axis=1, dtype=np.float32) if pcm.shape[1] > 1 else pcm[:, 0]
    if native_rate != rate:
        divisor = math.gcd(native_rate, rate)
        pcm = resample_poly(pcm, rate // divisor, native_rate // divisor)
    # The standard external protocol feeds exactly one second of digital zero.
    return np.r_[np.ascontiguousarray(pcm, dtype=np.float32), np.zeros(rate, np.float32)]


def output_path(root, stream, track):
    filename = hashlib.sha256(track["key"].encode()).hexdigest()[:24] + ".json"
    return root / stream / track["dataset"] / filename


def write_json(path, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.part")
    temporary.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8", newline="\n")
    temporary.replace(path)


def write_result(path, track, events, rate, compute_seconds):
    result = {"key": track["key"], "id": track["id"], "dataset": track["dataset"],
              "beats": [event["time"] for event in events],
              "emitted": [event["emitted"] for event in events],
              "compute_s": compute_seconds, "duration": float(track["dur"]), "mode": "stream", "error": None,
              "params": {"sample_rate": rate, "internal_beat_rate": N.SR, "model_sha256": N.MODEL_SHA256,
                         "quantum": 128, "tempo_prior_w": .03, "minimum_bpm": 40, "maximum_bpm": 240,
                         "fixed_lag_s": 1, "availability": "Actual production input frontier; FIR/staging already included"}}
    write_json(path, result)


def gate_diagnostics(track, events):
    """Frozen tick-gate metrics; lane-only duplicate headers add no duration."""
    unique = {}
    header_count = 0
    for event in events:
        if event["kind"] == "header" and event["tick"] > 0:
            unique[event["generation"], event["tick"]] = bool(event["shown"])
            header_count += 1
    if not unique or len({generation for generation, _ in unique}) != 1:
        raise ValueError("Gate diagnostics require one parameter generation with valid tick headers.")
    count = math.ceil((float(track["dur"]) - N.T0) / N.DT) + 2
    shown = np.zeros(count, bool)
    for (_, tick), value in unique.items():
        if tick <= count:
            shown[tick - 1] = value
    times = N.T0 + np.arange(count) * N.DT
    shown, times = shown[times < track["dur"]], times[times < track["dur"]]
    # Missing headers occur while the production beat engine is cold/silent;
    # those completed grid ticks retain the closed presentation state.
    truth = np.asarray(track["beats"], np.float64)
    span = np.zeros(len(shown), bool)
    if len(truth) > 1:
        half = np.median(np.diff(truth)) / 2
        span = (times >= truth[0] - half) & (times <= truth[-1] + half)
    falling = shown[:-1] & ~shown[1:] & span[1:]
    opened = np.flatnonzero(shown)
    if len(opened):
        falling[:opened[0]] = False
    span_ticks = int(span.sum())
    return {"schema": 1, "key": track["key"], "dataset": track["dataset"],
            "duration": float(track["dur"]), "dt": N.DT, "t0": N.T0,
            "header_rows": header_count, "unique_header_ticks": len(unique),
            "duplicate_header_rows": header_count - len(unique), "music_ticks": len(shown),
            "span_ticks": span_ticks, "dropout_count": int(falling.sum()),
            "dropouts_per_min": float(falling.sum()) / (span_ticks * N.DT / 60) if span_ticks else 0.,
            "unlocked_share": float((~shown[span]).mean()) if span_ticks else 0.}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--driver", type=Path, required=True, help="Built rhythm-eval native executable")
    parser.add_argument("--lists", type=Path, required=True, help="Private frozen scorer list directory")
    parser.add_argument("--sets", default="gtzan,smc,asap")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--out", type=Path, required=True, help="Private run directory")
    parser.add_argument("--diagnostics-out", type=Path, help="Separate private gate-diagnostic directory")
    parser.add_argument("--diagnostics-only", action="store_true",
                        help="Fill missing gate diagnostics without writing existing beat results")
    parser.add_argument("--budget-seconds", type=float, default=480.0)
    args = parser.parse_args()
    if args.diagnostics_only and args.diagnostics_out is None:
        parser.error("--diagnostics-only requires --diagnostics-out")
    driver = args.driver.resolve(strict=True)
    driver_hash = hashlib.sha256(driver.read_bytes()).hexdigest()
    args.out.mkdir(parents=True, exist_ok=True)
    identity = {"driver_sha256": driver_hash, "sample_rate": args.sample_rate,
                "model_sha256": N.MODEL_SHA256, "sets": args.sets.split(",")}
    identity_path = args.out / "run-identity.json"
    if identity_path.exists() and json.loads(identity_path.read_text(encoding="utf-8")) != identity:
        raise ValueError("This directory belongs to another production build; use a fresh output directory.")
    identity_path.write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8", newline="\n")
    if args.diagnostics_out is not None:
        args.diagnostics_out.mkdir(parents=True, exist_ok=True)
        diagnostic_identity = {**identity, "gate_schema": 1,
                               "tool_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        diagnostic_identity_path = args.diagnostics_out / "run-identity.json"
        if (diagnostic_identity_path.exists() and
                json.loads(diagnostic_identity_path.read_text(encoding="utf-8")) != diagnostic_identity):
            raise ValueError("Gate diagnostics use another build/schema/tool; choose a fresh directory.")
        write_json(diagnostic_identity_path, diagnostic_identity)
    tracks = []
    for dataset in args.sets.split(","):
        tracks.extend(json.loads((args.lists / f"{dataset}.json").read_text(encoding="utf-8"))["tracks"])
    started, last_progress, completed = time.monotonic(), time.monotonic(), 0
    with tempfile.TemporaryDirectory(prefix="native-input-", dir=args.out) as scratch:
        audio_path, events_path = Path(scratch) / "input.f32", Path(scratch) / "events.jsonl"
        for track in tracks:
            paths = {stream: output_path(args.out, stream, track) for stream in ("tick", "analysis", "forward")}
            diagnostic_path = (output_path(args.diagnostics_out, "gate", track)
                               if args.diagnostics_out is not None else None)
            needed = (not diagnostic_path.exists() if args.diagnostics_only else
                      not all(path.exists() for path in paths.values()))
            if needed:
                if time.monotonic() - started >= args.budget_seconds:
                    break
                load_audio(track, args.sample_rate).tofile(audio_path)
                compute_start = time.perf_counter()
                subprocess.run([str(driver), "stream", str(audio_path), str(events_path), str(args.sample_rate)],
                               check=True, stdout=subprocess.DEVNULL)
                compute_seconds = time.perf_counter() - compute_start
                events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
                forward = [event for event in events if event["kind"] == "forward"]
                analysis = [event for event in events if event["kind"] == "analysis"]
                tick = [event for event in forward if event["shown"]]
                if not args.diagnostics_only:
                    for stream, chosen in (("tick", tick), ("analysis", analysis), ("forward", forward)):
                        write_result(paths[stream], track, chosen, args.sample_rate, compute_seconds)
                if diagnostic_path is not None:
                    write_json(diagnostic_path, gate_diagnostics(track, events))
            completed += 1
            if time.monotonic() - last_progress >= 30:
                print(json.dumps({"completed": completed, "expected": len(tracks),
                                  "elapsed_s": time.monotonic() - started}), flush=True)
                last_progress = time.monotonic()
    summary = {"complete": completed == len(tracks), "completed": completed, "expected": len(tracks),
               "elapsed_s": time.monotonic() - started, **identity}
    status_root = args.diagnostics_out if args.diagnostics_only else args.out
    write_json(status_root / "run-status.json", summary)
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()

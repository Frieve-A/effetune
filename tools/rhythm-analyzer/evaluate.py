"""Bounded, resumable dev evaluation of the production scalar reference.

The manifest and per-excerpt results are private evidence. Public provenance
contains dataset names and aggregate results, never training-file identifiers.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import time
import warnings

import mir_eval.beat
import numpy as np

import numeric as N
import reference as R


def score(beats, estimates, duration):
    ref = np.asarray(beats, np.float64)
    est = np.sort(np.asarray(estimates, np.float64))
    ref = ref[(ref >= 5.0) & (ref <= duration)]
    est = est[(est >= 5.0) & (est <= duration)]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        f70 = mir_eval.beat.f_measure(ref, est, f_measure_threshold=.07)
        _, cmlt, _, amlt = mir_eval.beat.continuity(ref, est)
    return {"F70": float(f70), "CMLt": float(cmlt), "AMLt": float(amlt)}


def revision():
    digest = hashlib.sha256()
    for name in ("numeric.py", "decoder.py", "reference.py", "evaluate.py"):
        digest.update((Path(__file__).parent / name).read_bytes())
    return digest.hexdigest()


def read_audio(entry):
    source = np.memmap(entry["audio_path"], dtype="<i2", mode="r",
                       offset=int(entry["offset_samples"]) * 2, shape=(int(entry["samples"]),))
    audio = source.astype(np.float32) / np.float32(32767.0)
    del source
    return np.r_[audio, np.zeros(N.SR, np.float32)]


def summarize(rows, expected, code_revision):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["dataset"]].append(row)
    per_set = {}
    for dataset, items in grouped.items():
        per_set[dataset] = {"excerpts": len(items)}
        for stream in ("tick", "forward", "analysis"):
            per_set[dataset][stream] = {metric: float(np.mean([r[stream][metric] for r in items]))
                                        for metric in ("F70", "CMLt", "AMLt")}
    equal_set = {stream: {metric: float(np.mean([r[stream][metric] for r in per_set.values()]))
                         for metric in ("F70", "CMLt", "AMLt")}
                 for stream in ("tick", "forward", "analysis")} if rows else {}
    return {"complete": len(rows) == expected, "excerpts": len(rows), "expected_excerpts": expected,
            "reference_revision": code_revision, "model_sha256": N.MODEL_SHA256,
            "per_set": per_set, "equal_set_mean": equal_set,
            "compute_s": sum(r["compute_s"] for r in rows), "read_s": sum(r["read_s"] for r in rows),
            "ticks": sum(r["ticks"] for r in rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True,
                        help="Private JSON: excerpts[{dataset,audio_path,offset_samples,samples,duration,beats}]")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--frontend", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="Private result directory")
    parser.add_argument("--budget-seconds", type=float, default=480.0)
    parser.add_argument("--dp-precision", choices=(32, 64), type=int, default=32)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))["excerpts"]
    with np.load(args.frontend, allow_pickle=False) as source:
        frontend = {key: source[key] for key in source.files}
    code_revision = revision()
    args.out.mkdir(parents=True, exist_ok=True)
    started, last_progress = time.monotonic(), time.monotonic()
    rows = []
    for index, entry in enumerate(manifest):
        result_path, score_path = args.out / f"{index:04d}.npz", args.out / f"{index:04d}.json"
        if result_path.exists() and score_path.exists():
            row = json.loads(score_path.read_text(encoding="utf-8"))
            if row["reference_revision"] != code_revision or row["dp_precision"] != args.dp_precision:
                raise ValueError("Saved results use a different reference; choose a fresh output directory.")
        else:
            if time.monotonic() - started >= args.budget_seconds:
                break
            read_start = time.perf_counter()
            audio = read_audio(entry)
            read_seconds = time.perf_counter() - read_start
            compute_start = time.perf_counter()
            # Frozen dev decoding covers activation timestamps strictly before EOF.
            # The one-second audio flush is needed by the frontend but is not scored.
            cutoff = int(np.sum(N.T0 + np.arange(len(audio) // N.HOP) * N.DT < entry["duration"]))
            result = R.run(args.model, frontend, audio=audio, dp_precision=args.dp_precision, stop_tick=cutoff)
            compute_seconds = time.perf_counter() - compute_start
            forward, analysis = result["forward"], result["analysis"]
            shown = forward[:, 3].astype(bool)
            row = {"index": index, "dataset": entry["dataset"], "ticks": len(result["activations"]),
                   "dp_precision": args.dp_precision, "reference_revision": code_revision,
                   "read_s": read_seconds, "compute_s": compute_seconds,
                   "tick": score(entry["beats"], N.T0 + forward[shown, 0] * N.DT, entry["duration"]),
                   "forward": score(entry["beats"], N.T0 + forward[:, 0] * N.DT, entry["duration"]),
                   "analysis": score(entry["beats"], N.T0 + analysis[:, 0] * N.DT, entry["duration"])}
            # Detailed activation/ring checkpoints belong to reference.py;
            # evaluation retains only the events needed to reproduce scores.
            np.savez_compressed(result_path, forward=forward, analysis=analysis)
            score_path.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8", newline="\n")
        rows.append(row)
        if time.monotonic() - last_progress >= 30:
            print(json.dumps({"completed": len(rows), "expected": len(manifest),
                              "elapsed_s": time.monotonic() - started}), flush=True)
            last_progress = time.monotonic()
    summary = summarize(rows, len(manifest), code_revision)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()

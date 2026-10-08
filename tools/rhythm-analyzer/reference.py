"""Write numerical checkpoints for production/native comparisons.

Audio is mono float32 at 24 kHz on the delay-compensated beat grid. Host rate
conversion and its actual availability belong to the native production driver.
"""
import argparse
import json
from pathlib import Path
import time

import numpy as np

from decoder import Decoder
import numeric as N


def run(model, frontend, audio=None, feature_input=None, activation_input=None, dp_precision=32, hard=None,
        stop_tick=None):
    result = {}
    if activation_input is None:
        feature_input = N.features(audio, frontend) if feature_input is None else np.asarray(feature_input, np.float32)
        if stop_tick is not None:
            feature_input = feature_input[:stop_tick]
        network = N.Tcn(N.read_model(model))
        logits, activations, tempo = network.run(feature_input)
        result.update(features=feature_input, logits=logits, activations=activations,
                      tempo=tempo, ring=network.ring.copy())
    else:
        activations, tempo = activation_input
        result.update(activations=np.asarray(activations, np.float32), tempo=np.asarray(tempo, np.float32))
    if hard is None:
        hard = np.zeros(len(activations), bool)
        if audio is not None:
            blocks = np.asarray(audio[:len(hard) * N.HOP]).reshape(len(hard), N.HOP)
            hard = np.all(blocks == 0.0, axis=1)
    decoder = Decoder(dp_precision=dp_precision)
    columns = decoder.run(result["activations"][:, 0], result["tempo"], hard)
    result.update(forward=np.asarray(decoder.forward_events, np.float64).reshape(-1, 4),
                  analysis=np.asarray(decoder.analysis_events, np.float64).reshape(-1, 3),
                  period=np.array([row[0] for row in columns]), phase=np.array([row[1] for row in columns]),
                  evidence=np.array([row[2] for row in columns]), confidence=np.array([row[3] for row in columns]),
                  shown=np.array([row[4] for row in columns], bool),
                  committed_path=np.array(decoder.committed_path, np.int64),
                  committed_availability=np.array(decoder.committed_availability, np.int64),
                  posterior=decoder.alpha.copy(), viterbi=decoder.dp.copy(), hard=hard)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--audio", type=Path, help="Mono 24 kHz float32 .npy")
    source.add_argument("--features", type=Path, help="Float32 .npy [ticks,500]")
    source.add_argument("--activations", type=Path, help=".npz with activations [ticks,2], tempo [ticks,61], optional hard")
    parser.add_argument("--model", type=Path)
    parser.add_argument("--frontend", type=Path, help="The generated frontend.npz")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dp-precision", type=int, choices=(32, 64), default=32)
    args = parser.parse_args()
    if not args.activations and not args.model:
        parser.error("--model is required for network inference")
    if args.audio and not args.frontend:
        parser.error("--frontend is required for audio inference")
    inputs = {}
    if args.audio:
        inputs["audio"] = np.load(args.audio, allow_pickle=False)
    if args.features:
        inputs["feature_input"] = np.load(args.features, allow_pickle=False)
    if args.activations:
        with np.load(args.activations, allow_pickle=False) as data:
            inputs["activation_input"] = data["activations"], data["tempo"]
            if "hard" in data:
                inputs["hard"] = data["hard"]
    started = time.perf_counter()
    if args.frontend:
        with np.load(args.frontend, allow_pickle=False) as data:
            frontend = {key: data[key] for key in data.files}
    else:
        frontend = None
    result = run(args.model, frontend, dp_precision=args.dp_precision, **inputs)
    elapsed = time.perf_counter() - started
    result["metadata"] = json.dumps({"model_sha256": N.MODEL_SHA256, "ticks": len(result["activations"]),
                                      "dp_precision": args.dp_precision, "sample_rate": N.SR,
                                      "dt": N.DT, "t0": N.T0, "frontend_latency": N.LATENCY,
                                      "compute_s": elapsed, "numeric_policy": "ordered-scalar-no-fma-v1"})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **result)
    print(json.dumps({"ticks": len(result["activations"]), "forward_events": len(result["forward"]),
                      "analysis_events": len(result["analysis"]), "compute_s": elapsed}))


if __name__ == "__main__":
    main()

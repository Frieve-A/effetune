"""Export the frozen drum EMA and synthetic parity fixture; --thresholds overrides CAL3 logits."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.fft import rfft

from export import cpp_array, format_header, write_text

CLASSES = ("KD", "SD", "HH", "TT", "CY")
CHECKPOINT_SHA256 = "a20e918e34fa70e2d2bbe02c46b7b593d7459404bafcffa7ee29720addab2989"
AGC_REFERENCE = 7764.884088152459
AGC_SMOOTH = 1 / 300


def features(audio):
    edges = 700 * (10 ** (np.linspace(2595 * np.log10(1 + 30 / 700),
                                    2595 * np.log10(1 + 20000 / 700), 130) / 2595) - 1)
    hz = np.arange(1025) * 44100 / 2048
    mel = np.maximum(0, np.minimum((hz[:, None] - edges[:-2]) / (edges[1:-1] - edges[:-2]),
                                  (edges[2:] - hz[:, None]) / (edges[2:] - edges[1:-1]))).astype("f4")
    hann = signal.windows.hann(2048, sym=False).astype("f4")
    n = (len(audio) + 440) // 441
    padded = np.pad(audio, (1607, n * 441 - len(audio)))
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2048)[::441]
    power = np.abs(rfft(windows * hann, axis=1, workers=1)) ** 2
    energy = power @ mel
    broadband = np.sum(energy, axis=1, dtype="f8")
    average = signal.lfilter([AGC_SMOOTH], [1, -(1 - AGC_SMOOTH)], broadband)
    correction = -np.expm1(np.arange(1, len(energy) + 1) * np.log1p(-AGC_SMOOTH))
    gain = AGC_REFERENCE / np.maximum(average / correction, AGC_REFERENCE * 1e-6)
    normalized = (energy * gain[:, None]).astype("f4")
    return np.log1p(10 * normalized).astype("f4"), hann, mel


def events(raw, thresholds):
    shifted = np.concatenate((raw[6:], np.repeat(raw.min(0, keepdims=True), 6, axis=0)))
    result = []
    for cls in range(5):
        previous = -100
        for n in range(1, len(shifted) - 1):
            v = shifted[n, cls]
            if (v >= shifted[n - 1, cls] and v > shifted[n + 1, cls]
                    and v >= thresholds[cls] and n - previous >= 3):
                previous = n
                result.append({"class": cls, "frame": n, "time": (n + 1) / 100,
                               "logit": float(v), "raw_frame": n + 6,
                               "available_sample": min((n + 8) * 441, len(raw) * 441)})
    return sorted(result, key=lambda event: (event["frame"], event["class"]))


def fixture_audio():
    """Original deterministic synthesis; contains no third-party recordings or training material."""
    rate = 44100
    audio = np.zeros(rate * 10 + 137, "f4")
    rng = np.random.default_rng(20261028)
    for onset in np.arange(.2, 9.8, .25):
        start = round(onset * rate)
        length = min(round(.35 * rate), len(audio) - start)
        t = np.arange(length) / rate
        index = round((onset - .2) / .25)
        noise = rng.uniform(-1, 1, length)
        hit = .05 * noise * np.exp(-t * 65)
        if index % 2 == 0:
            hit += .6 * np.sin(2 * np.pi * (47 * t + .065 * (1 - np.exp(-t * 45)))) * np.exp(-t * 20)
        if index % 4 == 2:
            hit += .35 * noise * np.exp(-t * 24) + .15 * np.sin(2 * np.pi * 180 * t) * np.exp(-t * 30)
        if index % 16 == 0:
            hit += .1 * noise * np.exp(-t * 8)
        audio[start:start + length] += hit.astype("f4")
    return audio


def reference_model():
    import torch
    from torch import nn

    class Causal(nn.Module):
        def __init__(self):
            super().__init__()
            def conv(cin, cout):
                return nn.Sequential(nn.ZeroPad2d((1, 1, 2, 0)), nn.Conv2d(cin, cout, 3))
            self.frequency = nn.Sequential(conv(1, 16), nn.ReLU(), nn.MaxPool2d((1, 4)),
                                           conv(16, 32), nn.ReLU(), nn.MaxPool2d((1, 4)),
                                           conv(32, 48), nn.ReLU(), nn.MaxPool2d((1, 2)))
            self.recurrent = nn.GRU(192, 216, num_layers=2, batch_first=True)
            self.heads = nn.ModuleList(nn.Linear(216, 1) for _ in range(5))

        def forward(self, x):
            z = self.frequency(x[:, None]).permute(0, 2, 1, 3).flatten(2)
            z, _ = self.recurrent(z)
            return torch.cat([head(z) for head in self.heads], -1)
    return Causal()


def main(argv=None):
    import torch
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--thresholds", type=Path, help="JSON with thresholds (five-class logits) and selection (method string); defaults to CAL3 fit")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--clang-format", type=Path)
    args = parser.parse_args(argv)
    digest = hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
    summary = json.loads(args.summary.read_text(encoding="utf-8"))
    if digest != CHECKPOINT_SHA256 or summary["checkpoint_sha256"] != digest or summary["weights"] != "EMA":
        raise ValueError("Checkpoint and EMA evaluation must match the frozen shipping model.")
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model = reference_model().eval()
    model.load_state_dict(state["ema"], strict=True)
    arrays = []
    tensors = []
    offset = 0
    for name, tensor in state["ema"].items():
        values = tensor.numpy().astype("<f2")
        if not np.isfinite(values).all():
            raise ValueError(f"Non-finite export: {name}")
        if values.ndim == 4:
            values = values.transpose(1, 2, 3, 0)
        elif values.ndim == 2:
            values = values.T
        arrays.append(np.ascontiguousarray(values).view("<u2").reshape(-1))
        tensors.append({"name": name, "shape": list(tensor.shape), "stored_shape": list(values.shape),
                        "offset": offset, "elements": tensor.numel()})
        offset += tensor.numel()
    codes = np.concatenate(arrays)
    assert len(codes) == 566669
    blob = codes.astype("<u2").tobytes()
    threshold_values = summary["calibration"]["thresholds"]
    threshold_selection = {"method": "CAL3 fit on the synthetic calibration set"}
    if args.thresholds:
        threshold_config = json.loads(args.thresholds.read_text(encoding="utf-8"))
        if (not isinstance(threshold_config, dict)
                or not isinstance(threshold_config.get("selection"), dict)
                or not isinstance(threshold_config["selection"].get("method"), str)):
            raise ValueError("Threshold JSON must contain thresholds and a selection object with a method string.")
        threshold_values = threshold_config.get("thresholds")
        threshold_selection = threshold_config["selection"]
    if (not isinstance(threshold_values, dict) or set(threshold_values) != set(CLASSES)
            or any(not isinstance(value, (int, float)) or isinstance(value, bool)
                   or not np.isfinite(value) for value in threshold_values.values())):
        raise ValueError("Thresholds must contain exactly five finite numbers: KD, SD, HH, TT, CY.")
    thresholds = [threshold_values[name] for name in CLASSES]
    args.out.mkdir(parents=True, exist_ok=True)
    namespace = "effetune::plugins::analyzer::drum"
    header = f"// Generated by tools/rhythm-analyzer/export.py --drums. Binary16 RNE EMA weights.\n#pragma once\n#include <cstdint>\nnamespace {namespace} {{\n"
    header += cpp_array("kDrumWeights", codes, "std::uint16_t")
    header += "inline constexpr unsigned kDrumOffsets[] = {" + ",".join(str(t["offset"]) + "u" for t in tensors) + "};\n"
    header += f"}} // namespace {namespace}\n"
    header = format_header(header, "drum_weights.h", args.clang_format)
    write_text(args.out / "drum_weights.h", header)
    calibration = f"// Generated logit thresholds; KD, SD, HH, TT, CY.\n#pragma once\nnamespace {namespace} {{\n"
    calibration += cpp_array("kThresholds", thresholds, "float")
    calibration += "inline constexpr unsigned kTelemetryClasses[] = {0u, 1u, 2u, 4u, 3u};\n"
    calibration += f"}} // namespace {namespace}\n"
    write_text(args.out / "drum_calibration.h", format_header(calibration, "drum_calibration.h", args.clang_format))
    audio = fixture_audio()
    x, hann, mel = features(audio)
    table = f"// Generated periodic Hann and sparse HTK mel filters.\n#pragma once\nnamespace {namespace} {{\n"
    table += cpp_array("kHann", hann, "float")
    weights, bands = [], []
    for band in mel.T:
        indices = np.flatnonzero(band)
        bands.append((int(indices[0]), len(indices), len(weights)))
        weights.extend(band[indices])
    table += cpp_array("kMelWeights", weights, "float")
    table += "inline constexpr unsigned kMelBands[128][3] = {\n"
    table += "\n".join("{" + ",".join(str(v) + "u" for v in band) + "}," for band in bands) + "\n};\n"
    table += f"}} // namespace {namespace}\n"
    write_text(args.out / "drum_frontend_tables.h", format_header(table, "drum_frontend_tables.h", args.clang_format))
    torch.set_num_threads(1)
    with torch.inference_mode():
        original = model(torch.from_numpy(x)[None]).numpy()[0]
        model.load_state_dict({key: value.half().float() for key, value in state["ema"].items()})
        rounded = model(torch.from_numpy(x)[None]).numpy()[0]
        quiet_features, _, _ = features((audio * np.float32(.1)).astype("f4"))
        quiet_logits = model(torch.from_numpy(quiet_features)[None]).numpy()[0]
    fixture = args.out / "fixtures"
    fixture.mkdir(exist_ok=True)
    for name, values in (("input", audio), ("features", x), ("logits", rounded), ("ema-logits", original),
                         ("minus20-features", quiet_features), ("minus20-logits", quiet_logits)):
        (fixture / f"drum-{name}.f32").write_bytes(values.astype("<f4").tobytes())
    expected = events(rounded, thresholds)
    (fixture / "drum-events.u32").write_bytes(np.asarray(
        [(event["class"], event["frame"]) for event in expected], dtype="<u4").tobytes())
    quiet_events = events(quiet_logits, thresholds)
    (fixture / "drum-minus20-events.u32").write_bytes(np.asarray(
        [(event["class"], event["frame"]) for event in quiet_events], dtype="<u4").tobytes())
    original_events = events(original, thresholds)
    exact = [(e["class"], e["frame"]) for e in expected] == [(e["class"], e["frame"]) for e in original_events]
    fixture_meta = {"sample_rate": 44100, "samples": len(audio), "frames": len(x),
                    "source": "Original deterministic synthetic percussion; no training or third-party audio",
                    "license": "MIT", "events": expected, "ema_events": original_events,
                    "minus20_events": quiet_events,
                    "fp16_ema_event_identity": exact,
                    "fp16_ema_max_logit_difference": float(np.abs(original - rounded).max()),
                    "timing": {"lookahead_frames": 6, "peak_wait_frames": 1,
                               "anchor_seconds": "(frame + 1) / 100", "availability_seconds": "(frame + 8) / 100",
                               "resampler_delay_seconds": "0 at 44100 Hz; 191 / input_rate otherwise",
                               "instance_scheduling_seconds": "floor(input_rate * (instance_salt % 32) / 4000) / input_rate; pending inference is drained immediately at EOF"}}
    write_text(fixture / "drum-reference.json", json.dumps(fixture_meta, indent=2) + "\n")
    provenance = {"artifact": "drum_weights.h", "checkpoint_sha256": digest, "weights": "EMA",
                  "export_sha256": hashlib.sha256(blob).hexdigest(), "network_bytes": len(blob),
                  "header_sha256": hashlib.sha256(header.encode()).hexdigest(),
                  "model": "Causal CRNN c6-agc-a1", "parameters": len(codes), "tensors": tensors,
                  "classes": CLASSES, "thresholds": dict(zip(CLASSES, thresholds)),
                  "threshold_selection": threshold_selection,
                  "architecture": {"conv_channels": [1, 16, 32, 48], "frequency_pool": [4, 4, 2],
                                   "gru_hidden": 216, "gru_layers": 2, "lookahead_frames": 6},
                  "frontend": {"sample_rate": 44100, "fft": 2048, "hop": 441, "mel_bands": 128,
                               "agc": {"reference": AGC_REFERENCE, "smooth": AGC_SMOOTH,
                                       "floor_relative": 1e-6, "bias_corrected": True,
                                       "origin": "stream start", "domain": "linear mel power"},
                               "resampler": "RationalResampler, 383 taps, cutoff 0.47 * min(input_rate, 44100)"},
                  "timing": fixture_meta["timing"],
                  "evaluation": {name: {key: value for key, value in data.items() if key.startswith("micro_")}
                                 for name, data in summary["datasets"].items()
                                 if name in ("IDMT", "ENST", "MDBDrums")},
                  "generator": "tools/rhythm-analyzer/export.py --drums"}
    write_text(args.out / "drum_weights.provenance.json", json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({"network_bytes": len(blob), "export_sha256": provenance["export_sha256"],
                      "events": len(expected), "fp16_ema_event_identity": exact}))


if __name__ == "__main__":
    main()

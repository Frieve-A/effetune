import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import wave

workspace = Path("batch-demo")
inputs = workspace / "inputs"
outputs = workspace / "outputs"
inputs.mkdir(parents=True)
outputs.mkdir()
preset = workspace / "volume.json"
preset.write_text(json.dumps({
    "version": 1,
    "chain": [{
        "id": "volume",
        "type": "Volume",
        "parameters": {"volume": -6},
    }],
}), "utf-8")


def write_wave(target, period):
    with wave.open(str(target), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(48_000)
        for frame in range(4096):
            sample = round(0.5 * math.sin(2 * math.pi * frame / period) * 32767)
            output.writeframesraw(struct.pack("<hh", sample, sample))


write_wave(inputs / "first.wav", 97)
write_wave(inputs / "second.wav", 193)
(inputs / "invalid.wav").write_bytes(b"not a wave file")

failures = []
for source in sorted(inputs.glob("*.wav")):
    target = outputs / source.name
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "effetune",
            "render",
            str(source),
            str(target),
            "--preset",
            str(preset),
        ],
        check=False,
    )
    if result.returncode:
        failures.append((source, result.returncode))

rendered = sorted(path.name for path in outputs.glob("*.wav"))
assert rendered == ["first.wav", "second.wav"]
assert len(failures) == 1 and failures[0][0].name == "invalid.wav"
for source, code in failures:
    print(f"{source}: render failed with exit code {code}")

import json
import math
from pathlib import Path
import struct
import wave

rate = 48_000
frames = 4096
with wave.open("input.wav", "wb") as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(rate)
    for frame in range(frames):
        sample = round(0.5 * math.sin(2 * math.pi * frame / 97) * 32767)
        output.writeframesraw(struct.pack("<hh", sample, sample))

Path("volume.json").write_text(
    json.dumps({
        "version": 1,
        "chain": [{
            "id": "volume",
            "type": "Volume",
            "parameters": {"volume": -6},
        }],
    }, indent=2) + "\n",
    encoding="utf-8",
)

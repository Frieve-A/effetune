import json
from pathlib import Path

import numpy as np
import soundfile as sf

import effetune as et


chain = {
    "version": 1,
    "chain": [{
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
        "assets": {"impulseResponse": "room-ir"},
    }],
}
ir_samples = np.array([[0.75, 0.2]], dtype=np.float32)
ir = et.AssetData(ir_samples, 48_000, topology="automatic")
bundle = et.Bundle.pack("python-bundle", chain, {"room-ir": ir})
loaded = et.Bundle.load("python-bundle")
assert loaded.manifest == bundle.manifest

source = np.zeros((2, 1024), dtype=np.float32)
source[:, 0] = (0.5, -0.25)
output = et.Chain.from_bundle("python-bundle").process(
    source,
    sample_rate=48_000,
    block_size=64,
)
assert np.isfinite(output).all()
assert np.max(np.abs(output)) > 1e-7

Path("room-chain.json").write_text(
    json.dumps(chain, indent=2) + "\n",
    encoding="utf-8",
)
sf.write("room-ir.wav", ir_samples.T, 48_000, subtype="FLOAT")
sf.write("input.wav", source.T, 48_000, subtype="FLOAT")

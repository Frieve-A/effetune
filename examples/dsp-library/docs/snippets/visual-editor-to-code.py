import json
import os
from pathlib import Path

import numpy as np
import effetune as et

exported = json.loads(Path(os.environ["DSP_VISUAL_GOLDEN"]).read_text("utf-8"))
chain, report = et.Chain.from_legacy_preset(exported)
assert isinstance(report.warnings, tuple)
audio = np.ones((2, 256), dtype=np.float32) * np.float32(0.25)
output = chain(audio, 48_000, seed=0)
expected = audio * np.float32(10 ** (-6 / 20))
assert output.shape == audio.shape
assert np.allclose(output, expected, rtol=1e-5, atol=1e-6)

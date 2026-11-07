import sys

import numpy as np
import effetune as et

SAMPLE_RATE = 48_000
bank = et.SoundFontBank.load(sys.argv[1] if len(sys.argv) > 1 else "piano.etsf")
chain = et.Chain(
    [et.SoundFontPlayer(id="piano", assets={"soundFont": "piano"})],
    asset_resolver=lambda _reference: bank,
)
silence = np.zeros((2, SAMPLE_RATE), dtype=np.float32)
with chain.stream(SAMPLE_RATE, channels=2) as stream:
    # Middle C on MIDI channel 1 for half a second, then the release tail.
    output = stream.process(silence, events=[
        {"frame": 0, "effectId": "piano", "midi": [0x90, 60, 100]},
        {"frame": 24_000, "effectId": "piano", "midi": [0x80, 60, 0]},
    ])
assert np.isfinite(output).all()
assert np.max(np.abs(output[:, :24_000])) > 1e-4

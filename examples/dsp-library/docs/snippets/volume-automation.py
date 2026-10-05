import numpy as np
import effetune as et

sample_rate = 48_000
audio = np.full((2, 1024), 0.25, dtype=np.float32)
chain = et.Chain([et.Volume(id="level", volume=0)])
with chain.stream(sample_rate, channels=2, block_size=128) as stream:
    output = stream.process(audio, events=[
        {"frame": 128, "effectId": "level", "parameters": {"volume": -6}},
        {"frame": 608, "effectId": "level", "parameters": {"volume": -12}},
    ])

# Each target change completes after 240 samples at 48 kHz.
np.testing.assert_allclose(output[:, :128], 0.25, rtol=0, atol=1e-7)
np.testing.assert_allclose(output[:, 367:608], 0.25 * 10 ** (-6 / 20), atol=1e-7)
np.testing.assert_allclose(output[:, 847:], 0.25 * 10 ** (-12 / 20), atol=1e-7)
print({frame: float(output[0, frame]) for frame in (127, 128, 367, 608, 847)})

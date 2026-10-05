import numpy as np
import effetune as et

rate = 48_000
t = np.arange(rate, dtype=np.float64) / rate
mono = (0.1 * np.sin(2 * np.pi * 40 * t)
        + 0.1 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32)
audio = np.zeros((3, rate), dtype=np.float32)
audio[0] = audio[1] = mono  # Channels 0/1: left/right; channel 2: silent Sub slot.
chain = et.Chain([et.BassManagement(
    phase="IIR",
    roles=[1, 1, 3] + [0] * 13,
    routes=[4, 4] + [0] * 14,
    subs=4,  # 1 << 2: third output.
    frequencies=[80] * 16,
    slopes=[24] * 16,
    headroom=-6,
)])
output = chain.process(audio, sample_rate=rate)
assert output.shape == audio.shape
assert np.isfinite(output).all()
assert np.max(np.abs(output[2])) > 0.01
steady = np.abs(np.fft.rfft(output[:, rate // 2:]))
assert steady[0, 20] < 0.1 * steady[0, 500]  # Main: 40 Hz below 1 kHz.
assert steady[2, 500] < 0.1 * steady[2, 20]  # Sub: 1 kHz below 40 Hz.
print("Left, right, Sub:", output.shape)

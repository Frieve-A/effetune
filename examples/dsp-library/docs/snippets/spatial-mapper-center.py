import numpy as np
import effetune as et

rate = 48_000
direct = [0.0] * 256
direct[2 * 16 + 0] = direct[2 * 16 + 1] = 0.7
identity = [1.0 if row == column else 0.0 for row in range(16) for column in range(16)]
# These are the app's Center Extract preset values in semantic API names.
effect = et.SpatialMapper(
    input_channels=2, bands="24", directness=90, separation=85,
    diffuse_extraction=50, phase_sensitivity=50, temporal_smoothing=50,
    energy_preservation=True,
    direct_matrix=direct, diffuse_matrix=identity, residual_matrix=identity,
)
chain = et.Chain([effect])
t = np.arange(rate, dtype=np.float64) / rate
audio = np.zeros((3, rate), dtype=np.float32)
audio[0] = audio[1] = 0.1 * np.sin(2 * np.pi * 440 * t)
delay = chain.latency_samples(rate, channels=3)
output = chain.process(np.pad(audio, ((0, 0), (0, delay))), sample_rate=rate)
aligned = output[:, delay:delay + rate]
assert aligned.shape == audio.shape
assert np.isfinite(aligned).all()
assert np.max(np.abs(aligned[2])) > 0.01
print("Left, right, extracted center:", aligned.shape)

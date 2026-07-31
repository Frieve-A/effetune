import numpy as np
import effetune as et

frames = 512
phase = np.arange(frames, dtype=np.float32)
mono = (0.5 * np.sin(2 * np.pi * phase / 97)).astype(np.float32)
audio = np.ascontiguousarray(np.stack((mono, mono)))
chain = et.Chain([et.Volume(volume=-6)])
output = chain.process(audio, sample_rate=48_000)
print(output.shape, float(np.max(np.abs(output))))

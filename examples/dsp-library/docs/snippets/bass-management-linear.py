import numpy as np
import effetune as et

rate, taps, cutoff, slope = 48_000, 8192, 80, 24
# Sample a low-pass magnitude curve and center its FIR at taps / 2.
fft_size = 2 * taps
frequencies = np.fft.rfftfreq(fft_size, 1 / rate)
magnitude = 1 / (1 + (frequencies / cutoff) ** (slope / (20 * np.log10(2))))
bins = np.arange(magnitude.size)
spectrum = magnitude * np.exp(-2j * np.pi * bins * (taps / 2) / fft_size)
impulse = np.fft.irfft(spectrum, n=fft_size)[:taps]
indices = np.arange(taps)
edge = taps * 0.05
window = np.ones(taps)
window[indices < edge] = 0.5 - 0.5 * np.cos(np.pi * indices[indices < edge] / edge)
window[indices > taps - edge] = (
    0.5 - 0.5 * np.cos(np.pi * (taps - indices[indices > taps - edge]) / edge)
)
coefficients = np.ascontiguousarray(np.stack([impulse * window] * 2), dtype=np.float32)
asset = et.AssetData(
    coefficients, rate, topology="matrix",
    paths=(et.ConvolutionPath(0, 0, 0), et.ConvolutionPath(1, 1, 1)),
    input_count=3,
)
chain = et.Chain([et.BassManagement(
    phase="Linear", taps=str(taps),
    roles=[1, 1, 3] + [0] * 13,
    routes=[4, 4] + [0] * 14, subs=4,
    frequencies=[cutoff] * 16, slopes=[slope] * 16, headroom=-6,
    assets={"impulseResponse": "memory:lowpass"},
)], asset_resolver=lambda reference: asset if reference == "memory:lowpass" else None)
t = np.arange(rate, dtype=np.float64) / rate
audio = np.zeros((3, rate), dtype=np.float32)
audio[0] = audio[1] = 0.1 * np.sin(2 * np.pi * 40 * t) + 0.1 * np.sin(2 * np.pi * 1000 * t)
delay = chain.latency_samples(rate, channels=3)
# Include zeros after the signal so delayed output is retained.
output = chain.process(np.pad(audio, ((0, 0), (0, delay))), sample_rate=rate)
aligned = output[:, delay:delay + rate]
assert delay == taps // 2 + 128
assert np.isfinite(aligned).all()
assert np.max(np.abs(aligned[2])) > 0.01
steady = np.abs(np.fft.rfft(aligned[:, rate // 2:]))
assert steady[0, 20] < 0.1 * steady[0, 500]
assert steady[2, 500] < 0.1 * steady[2, 20]
print("Latency and left/right/Sub shape:", delay, aligned.shape)

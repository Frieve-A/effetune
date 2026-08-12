import numpy as np
import effetune as et

audio = np.full((2, 128), 0.25, dtype=np.float32)
graph = et.Graph.wet_dry(
    et.Volume(id="wet", volume=-6),
    dry=0.5,
    wet=0.5,
)
stream = None

try:
    offline = graph.process(audio, sample_rate=48_000)
    stream = graph.stream(48_000, channels=2, block_size=128)
    continuous = stream.process(audio)
    print(
        float(offline[0, 0]),
        float(continuous[0, 0]),
        stream.latency_samples,
        stream.compile_snapshot["effectiveSchedule"],
    )
finally:
    if stream is not None:
        stream.close()
    graph.close()

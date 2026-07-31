import numpy as np
import effetune as et

SAMPLE_RATE = 48_000
COEFFICIENTS = {
    "a": (
        np.array([0.75, 0.2], dtype=np.float32),
        np.array([0.35, -0.1], dtype=np.float32),
    ),
    "b": (
        np.array([0.4, -0.3, 0.1], dtype=np.float32),
        np.array([0.8, 0.1, -0.05], dtype=np.float32),
    ),
}

for effect_type in (
    "FIRCrossover",
    "FiveBandFIRPEQ",
    "GroupDelayEQ",
    "IRReverb",
    "RoomEQ",
):
    channels = 4 if effect_type == "FIRCrossover" else 2
    source = np.zeros((channels, 4096), dtype=np.float32)
    source[0, 0] = 0.5
    source[1, 0] = -0.25
    outputs = []
    for ir_variant in ("a", "b"):
        coefficients = COEFFICIENTS[ir_variant]
        if effect_type == "FIRCrossover":
            frames = max(len(channel) for channel in coefficients)
            samples = np.zeros((2, frames), dtype=np.float32)
            for index, channel in enumerate(coefficients):
                samples[index, : len(channel)] = channel
            asset = et.AssetData(
                samples,
                SAMPLE_RATE,
                topology="matrix",
                paths=(
                    et.ConvolutionPath(0, 0, 0),
                    et.ConvolutionPath(1, 1, 0),
                    et.ConvolutionPath(0, 2, 1),
                    et.ConvolutionPath(1, 3, 1),
                ),
                input_count=2,
            )
            parameters = {
                "latencyMode": "0",
                "filterDelaySamples": 0,
                "bandCount": 2,
            }
        else:
            asset = et.AssetData(
                coefficients[0][np.newaxis, :],
                SAMPLE_RATE,
                topology="mono",
            )
            parameters = (
                {
                    "channelMode": "mono",
                    "latency": 0,
                    "convolutionRate": "full",
                    "wetLevel": 0,
                    "dryLevel": -96,
                    "preDelay": 0,
                }
                if effect_type == "IRReverb"
                else {"latencyMode": "0", "filterDelaySamples": 0}
            )
        chain = et.Chain.from_preset(
            {
                "version": 1,
                "chain": [{
                    "id": effect_type,
                    "type": effect_type,
                    "parameters": parameters,
                    "assets": {"impulseResponse": f"memory:{effect_type}"},
                }],
            },
            asset_resolver=lambda _reference, resolved=asset: resolved,
        )
        output = chain(source, SAMPLE_RATE, seed=0, block_size=64)
        assert output.shape == source.shape
        assert np.isfinite(output).all()
        assert np.max(np.abs(output)) > 1e-7
        outputs.append(output)
    assert np.max(np.abs(outputs[0] - outputs[1])) > 1e-5

import json
import sys

import effetune as et


types = [effect["type"] for effect in et.EFFECT_METADATA["effects"]]
assert len(types) == 93
assert list(et.EFFECT_CLASSES) == types
assert all(getattr(et, effect_type) is et.EFFECT_CLASSES[effect_type] for effect_type in types)
assert all("implementation" not in effect for effect in et.EFFECT_METADATA["effects"])

chain = et.Chain([
    et.BrickwallLimiter(id="limiter", lookahead=3),
    et.BrickwallLimiter(id="disabled", enabled=False, lookahead=10),
])
with chain.stream(48_000, channels=2, block_size=64) as stream:
    latency_samples = stream.latency_samples

destination = sys.argv[1] if len(sys.argv) > 1 else "python-contract.json"
with open(destination, "w", encoding="utf-8", newline="\n") as output:
    json.dump(
        {
            "catalog": et.EFFECT_METADATA,
            "latencySamples": latency_samples,
        },
        output,
        ensure_ascii=False,
        sort_keys=True,
    )
    output.write("\n")

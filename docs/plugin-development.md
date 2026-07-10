---
title: "Plugin Development Guide - EffeTune"
description: "How to add an EffeTune plugin with a JavaScript UI, C++ DSP kernel, generated parameter ABI, and parity tests."
lang: en
---

# Plugin Development Guide

EffeTune plugins have two cooperating parts:

- A JavaScript class under `plugins/` owns the UI, parameter validation, preset data,
  and a reference processor used by compatibility mode and golden-vector generation.
- A C++ kernel under `dsp/plugins/` is the production audio processor. The generated
  parameter ABI connects the JavaScript host to the native and WebAssembly builds.

Routing, buses, channel selection, master bypass, and Section gating are host concerns.
A DSP kernel processes the channel-major buffer it receives and does not implement those
features again.

## Files for a DSP Plugin

For a plugin named `MyPlugin` in category `example`, add or update:

```text
plugins/example/my_plugin.js                 # UI and JavaScript reference DSP
plugins/example/my_plugin.css                # only when custom UI styling is needed
dsp/plugins/example/my_plugin/params.json    # generated ABI source
dsp/plugins/example/my_plugin/cases.json     # reviewed parity matrix
dsp/plugins/example/my_plugin/kernel.cpp     # production DSP
dsp/plugins/example/my_plugin/golden/        # generated JavaScript outputs
dsp/plugins/example/my_plugin/native_test.cpp # complex state/allocation tests, when needed
dsp/registry.inc                             # one registration line
js/audio/dsp-rollout.js                      # enable only after all parity gates pass
```

Keep the plugin list and user documentation in sync when adding a new plugin. Entries in
`plugins/plugins.txt` and plugin documentation are ordered alphabetically by category and
plugin name; `Others` and `Control` remain last.

## 1. Build the JavaScript Class

The class still extends `PluginBase`. It owns user-facing state and must implement
`getParameters()`, `setParameters()`, and `createUI()`.

```javascript
class MyPlugin extends PluginBase {
    constructor() {
        super('My Plugin', 'Short, factual description');
        this.gn = 0;
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            const gain = 10 ** (parameters.gn / 20);
            for (let i = 0; i < data.length; ++i) data[i] *= gain;
            return data;
        `);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            gn: this.gn
        };
    }

    setParameters(params) {
        if (params.gn !== undefined) {
            this.gn = this.parseFiniteNumber(params.gn, -18, 18, this.gn);
        }
        if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.appendChild(this.createParameterControl(
            'Gain', -18, 18, 0.1, this.gn,
            value => this.setParameters({ gn: value }), 'dB'
        ));
        return container;
    }
}

window.MyPlugin = MyPlugin;
```

The registered processor is the behavioral reference. Keep it readable and deterministic:

- Return the input unchanged when disabled.
- Store persistent state on `context` and define exactly which changes reset it.
- Use `parameters.channelCount` and `parameters.blockSize`; audio is channel-major:
  all frames for channel 0, then all frames for channel 1, and so on.
- Avoid per-sample allocation. Preallocate or reuse typed arrays for stateful reference DSP.
- Use `context.__seededRandom ?? Math.random` when the algorithm needs random values so
  golden generation can reproduce the sequence.
- In hot signal-processing code, prefer a comparison or ternary expression to
  `Math.abs`, `Math.max`, or `Math.min` when it is equally clear.

The reference processor must remain available while `?dsp=off` and the documented
fallback policy are supported. Do not delete it merely because the C++ port is enabled.

## 2. Declare the Parameter ABI

`params.json` is the source for both the C++ parameter struct and the JavaScript packer.
Field keys must match the DSP-specific values returned by `getParameters()`. Do not
redeclare host-owned `type`, `enabled`, bus, or channel-routing fields in the schema.

```json
{
  "type": "MyPlugin",
  "tolerance": { "abs": 0.000001, "policy": "per-sample" },
  "fields": [
    {
      "name": "gainDb",
      "key": "gn",
      "kind": "float",
      "min": -18,
      "max": 18,
      "default": 0,
      "unit": "dB"
    }
  ]
}
```

Supported numeric kinds include `float`, `int`, `bool`, and declared enums. Repeated
structured UI data uses an object-array field instead of handwritten packing logic. For
example, a five-band `bands[i].gain` parameter declares `objectArrayKey`, `memberKey`,
and `count: 5`. Use the top-level bounded `structured` descriptor only when the numeric
layout cannot represent the data.

Run code generation after every schema change:

```bash
npm run gen:dsp
```

Generated files under `dsp/generated/` and `js/audio/dsp-params.generated.js` are
committed. Never edit them by hand.

## 3. Freeze the JavaScript Reference

Create `cases.json` before writing the kernel. Cases should cover:

- Constructor defaults and every enum or algorithm mode.
- Parameter boundaries and representative fractional values.
- Mono, stereo, supported multichannel routing, and odd block sizes.
- 44.1, 48, 96, and 192 kHz when sample rate affects the algorithm.
- Parameter events that distinguish state preservation from reset behavior.
- Silence, impulse, full-scale, or seeded noise where relevant.
- One-frame blocks for algorithms whose state update order is important.

Generate and self-check the golden set:

```bash
node tools/dsp-parity/generate.mjs --type MyPlugin
node tools/dsp-parity/run.mjs --type MyPlugin --self-check
```

Each plugin's committed `golden/` directory must remain within the 2 MiB budget. A golden
case must contain finite output unless the current plugin contract intentionally specifies
otherwise and the tolerance policy can evaluate it.

## 4. Implement the C++ Kernel

Use the generated struct and the registration macro:

```cpp
#include "effetune/kernel.h"
#include "MyPluginParams.h"

#include <cmath>
#include <cstdint>

namespace effetune::plugins::example {

class MyKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MyPluginParams)

public:
  void prepare(const PrepareInfo& info) override {
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
  }
  void reset() noexcept override {}

  void process(float* audio, std::uint32_t channel_count,
               std::uint32_t frame_count, const ProcessInfo&) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    const double gain = std::pow(10.0, static_cast<double>(params_.gainDb) / 20.0);
    const std::uint32_t samples = channel_count * frame_count;
    for (std::uint32_t index = 0u; index < samples; ++index) {
      audio[index] = static_cast<float>(static_cast<double>(audio[index]) * gain);
    }
  }

private:
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
};

} // namespace effetune::plugins::example

EFFETUNE_REGISTER_KERNEL(MyPlugin, effetune::plugins::example::MyKernel)
```

Add the registry entry in category and plugin order:

```cpp
EFFETUNE_PLUGIN(MyPlugin, example/my_plugin)
```

### Real-Time Rules

- Allocate all worst-case buffers in `prepare()`. `process()` must not allocate, resize,
  lock, log, perform file I/O, or call into JavaScript.
- Size for the ABI limits: up to eight channels, the prepared maximum block size, and the
  supported sample-rate range. If the legacy implementation overallocates, a smaller ring
  is acceptable only when it is mathematically equivalent and covered by wraparound tests.
- Validate pointers and prepared bounds before indexing. Invalid process shapes return
  without modifying audio.
- Preserve the JavaScript numeric boundaries. A `Float32Array` write is an explicit
  `static_cast<float>` in C++; ordinary JavaScript object fields normally retain `double`.
- Match the reference update order. Feedback filters, delay lines, and accumulators can
  diverge quickly when rounding moves across an operation.
- Use shared primitives under `dsp/include/effetune/dsp/` where their semantics match.
  Do not force a shared helper onto a legacy coefficient clamp or state rule that differs.
- For hot DSP comparisons, use `if` or a ternary expression instead of generic min/max or
  absolute-value helpers when doing so remains readable.
- `enabled` is host-owned. Disabled instances are skipped before kernel dispatch.
- Report algorithmic latency with `latencySamples()`; do not hide lookahead in state.

Document large worst-case allocations in `dsp/README.md`. A tolerance above the
archetype default requires a `toleranceNote` in `cases.json`; benchmark results and
performance exceptions belong in `tools/dsp-parity/BENCHMARKS.md`.

## 5. Add Native State Tests

Golden parity covers rectangular audio cases. Add `native_test.cpp` when behavior also
depends on lifecycle transitions that the golden format cannot express cleanly:

- `reset()` replay.
- Sample-rate, channel-count, or topology changes.
- Parameters that must preserve state.
- Disabled modes that freeze rather than advance state.
- Maximum 192 kHz, eight-channel capacity.
- Latency changes and telemetry cadence.

Wrap every direct `process()` call in `effetune::allocation_guard::Scope`. Register the
test target in `dsp/CMakeLists.txt` with the same warning-as-error settings as neighboring
DSP tests.

## 6. Verify Native and WebAssembly Parity

Run the native suite and the plugin's native parity cases first:

```bash
npm run test:dsp
node tools/dsp-parity/run.mjs --type MyPlugin --native
```

Then build both committed WebAssembly variants and test the actual artifacts:

```bash
npm run build:dsp
node tools/dsp-parity/run.mjs --type MyPlugin --wasm
node tools/dsp-parity/run.mjs --type MyPlugin --wasm --simd
```

Benchmark JavaScript, baseline WebAssembly, and SIMD at the required sample-rate and
channel combinations:

```bash
node tools/dsp-parity/bench.mjs --type MyPlugin --modes js,wasm,simd
```

Record reviewed results in `tools/dsp-parity/BENCHMARKS.md`. A tolerance increase is not a
substitute for locating a state, coefficient, routing, or precision mismatch.

## 7. Enable the Port

Add the exact type to `SHIPPED_ENABLED_TYPES` in `js/audio/dsp-rollout.js` only after:

1. Native, baseline WebAssembly, and SIMD parity pass.
2. Stateful and allocation tests pass at maximum supported capacity.
3. The benchmark and any justified exception are documented.
4. The committed artifact metadata contains the matching type and parameter hash.

The host falls back to JavaScript per plugin instance when construction, parameter
staging, or processing fails. Module or ABI startup failure disables WebAssembly for the
session. Keep both fallback levels working; rollout is not permission to remove them.

## Analyzer Telemetry

Analyzers and meters emit bounded binary telemetry frames from the kernel instead of
attaching JavaScript measurement objects. Use the shared telemetry writer and assign a
versioned frame type. Tests must cover:

- Header, tap ID, payload length, and finite-value validation.
- Cadence at 44.1, 48, 96, and 192 kHz.
- Overflow/drop accounting and malformed-frame rejection.
- The JavaScript adapter that updates the existing visualization state.

Do not post messages or allocate payloads from `process()`.

## UI and Parameter Requirements

- Prefer `PluginBase` helpers: `createParameterControl()`, `createSelectControl()`,
  `createCheckboxControl()`, `createRadioGroup()`, and `createGraphContainer()`.
- Give inputs stable IDs and names containing the plugin instance ID, associate labels
  with `htmlFor`, and set `autocomplete="off"`.
- Validate with `parseFiniteNumber()` and `isAllowedEnum()` or equivalent explicit checks.
- Make custom controls usable at a 375 px viewport and with pointer, touch, and pen input.
- Cancel animation frames and remove listeners in `cleanup()`.
- Keep analyzer drawing on the main thread; only capture and reduction belong in the DSP
  kernel.

## Final Checklist

Before handing the change back:

```bash
npm run gen:dsp
npm run test:dsp
npm run build:dsp
npm run assets:web
npm run verify
```

Also run the plugin's native/baseline/SIMD parity commands, focused host tests, benchmark,
artifact freshness check, and `git diff --check`. Review the final diff with
`code_review.md`. Do not start the Electron app or a local server unless that manual run
was explicitly requested.

Further ABI, build, and parity details are maintained in [the DSP README](https://github.com/Frieve-A/effetune/blob/main/dsp/README.md).

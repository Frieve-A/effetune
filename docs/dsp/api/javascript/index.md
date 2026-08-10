---
layout: dsp
title: "JavaScript API"
description: "JavaScript API"
lang: en
permalink: /dsp/api/javascript/
---
# JavaScript API

```console
npm install @effetune/dsp
```

The package is ESM-only. These signatures follow the shipped `index.d.ts` and
`worklet.d.ts`. The generated declarations remain authoritative for individual
effect options; the 83 named class/factory pairs are
not repeated here.

## Chain creation and offline processing

```ts
createChain(
  input: string | ChainDocumentInput | BundleDocument |
    readonly (Effect | ChainEffectInput)[],
  options?: CreateChainOptions
): Promise<Chain>

class Chain {
  readonly preset: ChainDocument
  readonly effects: readonly ChainEffect[]
  setParam(effectId: string, parameterName: string, value: unknown): this
  reset(): this
  prewarm(options: PrewarmOptions): Promise<this>
  latencySamples(options: {
    sampleRate: number
    channels?: number
    blockSize?: number
  }): Promise<number>
  stream(options: StreamOptions): Promise<ChainStream>
  process(
    audio: readonly Float32Array[],
    options: ProcessOptions
  ): Promise<Float32Array[]>
  close(): void
}
```

`ProcessOptions` requires `sampleRate` and optionally accepts `seed`,
`blockSize`, and `onTelemetry`. `CreateChainOptions` accepts
`assetResolver` plus baseline/SIMD artifact selection and URLs. Offline processing
returns newly owned channels with fresh state. All input channels must have equal
length, and every sample must be finite; non-finite input raises `ValidationError`
before native state is reached.

`latencySamples()` takes the same option shape as `prewarm()` without a seed
(`channels` defaults to 2 and `blockSize` to 128) and resolves to the aggregate an
opened stream would report for that rate and layout, without processing audio. Offline
`process()` output is not latency-compensated, so use this value to align it.

## Stateful stream

```ts
interface ChainStream {
  readonly preset: ChainDocument
  readonly effects: readonly ChainEffect[]
  readonly latencySamples: number
  readonly droppedTelemetryFrames: number
  subscribe(callback: TelemetryCallback): () => void
  unsubscribe(callback: TelemetryCallback): boolean
  setParam(effectId: string, parameterName: string, value: unknown): this
  reset(): this
  process(
    audio: readonly Float32Array[],
    options?: { events?: readonly ParameterEvent[] }
  ): Promise<Float32Array[]>
  close(): void
}
```

`StreamOptions` requires `sampleRate` and optionally accepts `channels`,
`seed`, `blockSize`, and `onTelemetry`. Event parameter objects are partial
updates applied in input order. Rejected non-finite blocks do not change stream state.
`latencySamples` is the live aggregate and is numerically symmetric with Python
`Stream.latency_samples`. Asset-configuration parameters listed under
[Streaming and events](/dsp/concepts/streaming-and-events/) require a newly opened
stream and are rejected before processing.

## ETA1 and catalog

```ts
encodeEta1(options: {
  channels: readonly Float32Array[]
  sampleRate: number
  topology?: "unspecified" | "mono" | "independent" | "trueStereo" | "matrix"
  paths?: readonly MatrixPath[]
}): ArrayBuffer

getEffectCatalog(): Readonly<{
  version: 1
  channels: readonly EffectChannel[]
  effects: readonly Readonly<Record<string, unknown>>[]
}>
const EFFECT_CATALOG: ReturnType<typeof getEffectCatalog>
createEffect<T extends EffectType>(
  type: T,
  ...options: T extends RequiredAssetEffectType
    ? [options: EffectOptionsByType[T]]
    : [options?: EffectOptionsByType[T]]
): EffectClassByType[T]
```

`encodeEta1()` validates finite, equal-length planar channels and matrix paths.
`EFFECT_CATALOG`, `EFFECT_CLASSES`, and all 83 root class/factory pairs cover the
same semantic catalog as Python without private implementation data.

## AudioWorklet

```ts
EffeTuneNode.create(
  context: BaseAudioContext,
  input: string | ChainDocumentInput | BundleDocument |
    readonly (Effect | ChainEffectInput)[],
  options?: EffeTuneNodeOptions
): Promise<EffeTuneNode>

node.subscribe(callback: TelemetryCallback): () => void
node.unsubscribe(callback: TelemetryCallback): boolean
node.setParam(effectId: string, parameterName: string, value: unknown): Promise<void>
node.reset(): Promise<void>
node.close(): void
node.latencySamples: number
node.droppedTelemetryFrames: number
```

Import `EffeTuneNode` from `@effetune/dsp/worklet`. The `latencySamples` getter
is refreshed by creation and awaited mutations; the wrapper does not accept scheduled
frame events. See
[Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry) for decoded
telemetry frame fields. Asset-configuration parameters listed under
[Streaming and events](/dsp/concepts/streaming-and-events/) cannot be changed on an
open node.

## Other exports and errors

`parsePreset()`, `importLegacyPreset()`, and `isBundleDocument()` handle semantic
documents. The public package entry points are derived from the package export map:

| Import specifier | Use |
|---|---|
| `@effetune/dsp` | Main ESM API: Chain, effects, ETA1, and catalog helpers |
| `@effetune/dsp/worklet` | AudioWorklet `EffeTuneNode` wrapper |
| `@effetune/dsp/processor` | Side-effect AudioWorklet processor module |
| `@effetune/dsp/schemas/chain-v1.json` | Chain v1 JSON Schema |
| `@effetune/dsp/schemas/bundle-v1.json` | Bundle v1 JSON Schema |
| `@effetune/dsp/catalog` | ESM catalog exports |
| `@effetune/dsp/catalog.json` | Machine-readable effect catalog JSON |

`ValidationError` covers audio/documents/options,
`EffectError` unknown effects, `AssetError` assets, `EffeTuneRuntimeError`
backend failures, and `StateError` invalid lifecycle operations.

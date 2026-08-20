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
effect options; the 92 named class/factory pairs are
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

## Graph and GraphStream

```ts
createGraph(
  input: string | GraphDocumentInput,
  options?: CreateGraphOptions
): Promise<Graph>

class Graph {
  static load(input: string | GraphDocumentInput, options?: CreateGraphOptions): Promise<Graph>
  static fromChain(chain: Chain | ChainDocumentInput |
                   readonly (Effect | ChainEffectInput)[],
                   options?: CreateGraphOptions): Promise<Graph>
  static wetDry(effect: Effect | ChainEffectInput, options?: WetDryGraphOptions): GraphDocument
  static sendReturn(effect: Effect | ChainEffectInput, options?: SendReturnGraphOptions): GraphDocument
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  toJSON(): GraphDocument
  toChain(): ChainDocument
  serialize(space?: number): string
  getNode(id: string): GraphNode | null
  getEdge(id: string): GraphEdge | null
  incoming(id: string): readonly GraphEdge[]
  outgoing(id: string): readonly GraphEdge[]
  structuralSnapshot(): GraphStructuralSnapshot
  visualizationSnapshot(): GraphVisualizationSnapshot
  process(audio: readonly Float32Array[], options: GraphProcessOptions): Promise<Float32Array[]>
  latencySamples(options: LatencyOptions): Promise<number>
  stream(options: GraphStreamOptions): Promise<GraphStream>
  close(): void
}

interface GraphStream {
  readonly graph: GraphDocument
  readonly latencySamples: number
  readonly compileSnapshot: GraphCompileSnapshot
  visualizationSnapshot(): GraphVisualizationSnapshot
  setParam(nodeId: string, parameterName: string, value: unknown): this
  process(audio: readonly Float32Array[]): Promise<Float32Array[]>
  reset(): this
  close(): void
}

interface GraphStructuralSnapshot {
  readonly document: GraphDocument
  readonly topologicalOrder: readonly string[]
  readonly incoming: Readonly<Record<string, readonly string[]>>
  readonly outgoing: Readonly<Record<string, readonly string[]>>
}
```

```ts
interface GraphProcessOptions {
  sampleRate: number
  seed?: number      // 0
  blockSize?: number // 128
}

interface GraphStreamOptions extends GraphProcessOptions {
  channels?: number  // 2
}

interface GraphRecipeOptions {
  nodeId?: string   // the effect's own id, else "wet" / "return"
  inputId?: string  // "input"
  outputId?: string // "output"
}

interface WetDryGraphOptions extends GraphRecipeOptions {
  wet?: number // 1
  dry?: number // 1
}

interface SendReturnGraphOptions extends GraphRecipeOptions {
  send?: number       // 1
  returnGain?: number // 1
}
```

The trailing comments show the defaults. `wet`, `dry`, `send`, and `returnGain`
become the linear gains on the edges emitted by each recipe. The recipe helpers return a
document rather than a `Graph`; see [Graph v1](/dsp/reference/graph-v1/#recipes) for
the canonical node and edge IDs.

When the `Graph.load()` input is a string it is Graph JSON text, not a file path or
URL. `toJSON()`, query results, and snapshots are caller-owned copies; treat snapshots
as read-only diagnostics. `toChain()` accepts only an empty Graph or one serial path
whose edges all use identity controls; it returns a new Chain document. `process()`
uses fresh state by opening and closing a stream
internally. For a nonempty graph, `createGraph()` / `Graph.load()` validate the
document and load the selected DSP artifact; `stream()` then prepares native instances
and assets and compiles the graph, so either phase can fail. `GraphStream.process()`
accepts only audio: passing options, including `events`, raises `ValidationError`
because scheduled events are not supported. Call `setParam()` only between awaited
process calls; an update outside the stream-safe allowlist raises `ValidationError`
with `GRAPH_RECONFIGURATION_REQUIRED`. An unknown node ID raises
`GRAPH_DOCUMENT_REFERENCE` and a value the catalog rejects raises
`GRAPH_DOCUMENT_PARAMETER`, both as `ValidationError`. `reset()` restores initial
parameters and state, and `close()` is idempotent.

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
`EFFECT_CATALOG`, `EFFECT_CLASSES`, and all 92 root class/factory pairs cover the
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
| `@effetune/dsp/schemas/graph-v1.json` | Graph v1 JSON Schema |
| `@effetune/dsp/schemas/bundle-v1.json` | Bundle v1 JSON Schema |
| `@effetune/dsp/catalog` | ESM catalog exports |
| `@effetune/dsp/catalog.json` | Machine-readable effect catalog JSON |

These synchronous Graph document builders never load the DSP artifact:

| Export | Result |
|---|---|
| `normalizeGraphDocument()` | Canonical Graph document from document input, with defaults materialized and nodes/edges sorted by ID |
| `graphDocumentFromChain()` | Serial Graph document built from a Chain document or effect list |
| `chainDocumentFromGraph()` | Chain document from an empty or serial identity-control Graph |
| `createWetDryGraphDocument()` | Same wet/dry document as `Graph.wetDry()` |
| `createSendReturnGraphDocument()` | Same send/return document as `Graph.sendReturn()` |

`ValidationError` covers audio/documents/options,
`EffectError` unknown effects, `AssetError` assets, `EffeTuneRuntimeError`
backend failures, and `StateError` invalid lifecycle operations.

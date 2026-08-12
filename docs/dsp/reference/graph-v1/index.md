---
layout: dsp
title: "Graph v1"
description: "Graph v1"
lang: en
permalink: /dsp/reference/graph-v1/
---
# Graph v1

Graph v1 is an experimental, opt-in processing model for explicit static audio DAGs.
It adds branching, deterministic additive merging, wet/dry and send/return routing,
edge controls, and automatic delay compensation without changing Chain v1. Choose a
Chain for an ordinary serial effect list; choose a Graph only when the routing itself is
part of the program.

The first version has one host main input and one host main output. Every effect node
still has one audio input and one audio output and uses the same semantic effect fields
as Chain v1. A graph is prepared before processing and remains structurally immutable
for the stream lifetime.

## Document

The [raw schema](/dsp/schemas/graph-v1.schema.json) is authoritative. This serial graph
uses flat Effect objects as nodes; there is no nested `effect` property:

```json
{
  "version": 1,
  "input": { "id": "input" },
  "output": { "id": "output" },
  "nodes": [
    {
      "id": "level",
      "type": "Volume",
      "enabled": true,
      "channel": "all",
      "parameters": { "volume": -6 }
    }
  ],
  "edges": [
    { "id": "input-level", "source": "input", "destination": "level" },
    { "id": "level-output", "source": "level", "destination": "output" }
  ]
}
```

The input, output, node, and edge IDs are stable nonempty strings. Endpoint and node IDs
share the reference namespace; edge IDs are also unique. Sources and destinations are
ID strings, not port objects. The input is source-only, the output is destination-only,
and every structural node and edge must lie on a path from input to output. Dangling
references, duplicate IDs, self-loops, cycles, and structurally disconnected elements
are rejected before processing.

Edge controls have these meanings:

| Field | Default | Contract |
|---|---:|---|
| `gain` | `1` | Finite linear amplitude from 0 through 4 |
| `mute` | `false` | A muted edge never contributes |
| `pan` | omitted, behaving as `0` | Optional linear stereo balance from -1 through 1; any explicit value is rejected outside a stereo stream |
| `mixGroup` | `"default"` | Selects the solo group at one destination |
| `solo` | `false` | If a group contains a solo edge, only its non-muted solo edges contribute |

Mute takes precedence over solo. An active edge applies gain, pan, fan-in compensation,
then summing. Edges entering one destination are summed by edge ID in UTF-8 byte order;
ready nodes use node ID in the same order. Document array order therefore does not
change audio. Canonical serialization materializes ordinary node and edge defaults and
sorts nodes and edges by ID. An omitted `pan` stays omitted so a caller's explicit pan
request remains distinguishable during stream-layout validation.

An empty graph is a unity, zero-latency identity. A disabled node is a zero-latency
identity bypass and does not create an effect instance. Mute and solo can make a branch
dormant without making the structural document invalid. An enabled node that still has
an active outgoing route to the output runs with zero-filled input even if all incoming
edges are suppressed, regardless of effect type. The presence of any such node prevents
the silence shortcut.

## APIs

JavaScript exposes the asynchronous `createGraph()`, `Graph`, and `GraphStream`
surface plus the synchronous document helpers `normalizeGraphDocument()`,
`graphDocumentFromChain()`, `chainDocumentFromGraph()`,
`createWetDryGraphDocument()`, and `createSendReturnGraphDocument()`. Python exposes
`Graph` and `GraphStream` with the same behavior and Python naming conventions, plus
the module-level `wet_dry_graph_document()` and `send_return_graph_document()`
builders.

A Graph can be loaded from a document, serialized, processed once with fresh state, or
opened as a stateful stream. It reports the prepared graph's common-max latency and
offers node, edge, adjacency, structural, and visualization queries. A GraphStream owns
the installed immutable plan and exposes processing, latency, the compile snapshot,
reset, safe parameter updates, and close. Both objects retain their own normalized copy;
mutating the caller's original document cannot alter an active plan.

`Graph.fromChain()` in JavaScript and `Graph.from_chain()` in Python create a serial
input-to-effects-to-output graph without changing the Chain or its parameters. They do
not replace Chain as the default API. A configuration that cannot meet Graph delay-
compensation rules fails with the same stable `code`, the same JSON `path`, and the
same offending node ID as the equivalent hand-written Graph document. The human-readable
message is not part of that guarantee, and the configuration is never silently rewritten.

Migration in the other direction is intentionally narrower. JavaScript `toChain()`
returns a Chain document, while Python `to_chain()` returns a new `Chain`. Conversion
is allowed only for an empty Graph or a single input-to-nodes-to-output serial path whose
every edge has identity controls: `gain = 1`, `mute = false`, `solo = false`,
`mixGroup = "default"`, and omitted or zero `pan`. Branching, merging, or any
non-identity edge control raises `GRAPH_DOCUMENT_CONNECTIVITY`; conversion never drops
routing behavior.

JavaScript conversion is asynchronous:

```js
import { Graph, createChain, createVolume } from '@effetune/dsp';

const chain = await createChain([createVolume({ id: 'level', volume: -6 })]);
const graph = await Graph.fromChain(chain);
graph.close();
chain.close();
```

Python conversion is synchronous and keeps Python naming conventions:

```python
import effetune as et

chain = et.Chain([et.Volume(id="level", volume=-6)])
graph = et.Graph.from_chain(chain)
graph.close()
```

### Supported surfaces

| Surface | Offline Graph | Stateful GraphStream | Status |
|---|---:|---:|---|
| JavaScript binding | Yes | Yes | Public Graph v1 API |
| Python binding | Yes | Yes | Public Graph v1 API |
| AudioWorklet / `EffeTuneNode` | No | No | Chain v1 only |
| CLI | No | No | Chain v1 documents only |
| Bundle documents | No | No | Bundles contain Chain v1 only |
| EffeTune app executor | No | No | The app pipeline does not execute Graph v1 |

Graph v1 has no scheduled parameter events. `GraphStream.process()` takes audio only;
JavaScript rejects a second options argument (including `{ events: ... }`) with
`ValidationError`, matching Python's audio-only method. Await each process call before
calling `setParam()` / `set_param()`; updates are supported only between process
calls, never concurrently with processing.

Only explicitly classified stream-safe parameters can change on an active GraphStream.
Parameters affecting latency, assets, channel selection, allocation, prepared state, or
delay-compensation eligibility require a new stream. This includes
`FIRCrossover.bandCount`, `IRReverb.channelMode`, and
`IRReverb.convolutionRate`. For a positive-latency IRReverb, crossing the
`dryLevel = -96 dB` eligibility boundary in either direction also requires a new stream.

The current stream-safe allowlist is deliberately small:

- `Volume.volume`.
- `IRReverb.dryLevel` when latency is zero, or when both the current and new values are
  `-96 dB`, the parameter minimum. The positive-latency wet-only eligibility rule still
  applies.

Every other parameter update raises `ValidationError` with
`GRAPH_RECONFIGURATION_REQUIRED`; create a new stream for that configuration.

## Recipes

Wet/dry and send/return are ordinary graph shapes, not separate runtime types.

JavaScript `Graph.wetDry()` / `Graph.sendReturn()` are exactly equivalent to
`createWetDryGraphDocument()` / `createSendReturnGraphDocument()`: the static methods
return the same canonical document as the function forms. Python `Graph.wet_dry()` /
`Graph.send_return()` construct a `Graph` from the same canonical document returned by
`wet_dry_graph_document()` / `send_return_graph_document()`. There is no hidden
difference between the corresponding forms.

- A wet/dry graph fans the input out to a dry edge and a wet effect node, then joins both
  at the output. Set the two output-edge gains for the desired mix.
- A send/return graph keeps the main route, adds an input-to-effect send edge, then mixes
  the effect's return edge at the destination. Additional sends use the same pattern.
- A positive-latency IRReverb must be wet-only internally: set `dryLevel` to
  `-96 dB`, the parameter minimum, and use an external dry edge. The compiler delays
  the shorter dry route to align it with the prepared wet route. Any internal dry value
  above the minimum is rejected rather than coerced.

| Recipe | Node ID | Edge IDs |
|---|---|---|
| Wet/dry | `nodeId`, else the effect's own ID, else `wet` | `dry`, `wet-input`, `wet-output` |
| Send/return | `nodeId`, else the effect's own ID, else `return` | `main`, `send`, `return` |
| `fromChain()` / `from_chain()` | Chain item IDs are kept | `route-1`, `route-2`, ... one per hop including the final hop to the output |

Endpoint IDs default to `input` and `output` for the wet/dry and send/return recipes;
`fromChain()` / `from_chain()` use `main-input` and `main-output`. For
`fromChain()` / `from_chain()`, a generated ID that collides with an existing node ID
gets a `-2`, `-3`, ... suffix.

This is the document produced by
`Graph.wetDry(createVolume({ id: 'wet', volume: -6 }), { dry: 0.5, wet: 0.5 })`:

```json
{
  "version": 1,
  "input": { "id": "input" },
  "output": { "id": "output" },
  "nodes": [
    {
      "id": "wet",
      "type": "Volume",
      "enabled": true,
      "channel": "all",
      "parameters": { "volume": -6 }
    }
  ],
  "edges": [
    {
      "id": "dry",
      "source": "input",
      "destination": "output",
      "gain": 0.5,
      "mute": false,
      "mixGroup": "main",
      "solo": false
    },
    {
      "id": "wet-input",
      "source": "input",
      "destination": "wet",
      "gain": 1,
      "mute": false,
      "mixGroup": "default",
      "solo": false
    },
    {
      "id": "wet-output",
      "source": "wet",
      "destination": "output",
      "gain": 0.5,
      "mute": false,
      "mixGroup": "main",
      "solo": false
    }
  ]
}
```

The two edges that reach the output share `mixGroup "main"`, so soloing either edge
selects between the wet and dry paths.

The document helpers only build canonical Graph documents. They add no hidden processing
semantics, buses, or special node types.

## Queries and snapshots

Document queries preserve the complete structural graph: normalized nodes and edges,
incoming and outgoing edge IDs, structural connectivity, and structural topological
order. The visualization snapshot contains the same structural elements and status data
but no coordinates or drawing dependency.

`structuralSnapshot()` / `structural_snapshot()` returns exactly four keys:
`document`, `topologicalOrder`, `incoming`, and `outgoing`.

The visualization snapshot's input and output endpoint entries contain only `id` and
`kind`; only effect nodes and edges carry a `state`.

The compile snapshot describes one prepared stream: effective, dormant, and disabled-
bypass elements; execution order; each node output's reusable buffer slot; processing
channel groups; node input/output and final-output latency; fan-in, pre-node, and final-
output compensation; common-max public latency; and capacity use. Treat snapshots as
read-only diagnostics. Graph v1 has no telemetry callback, subscription, or observation
API; analyzer telemetry remains available only on the documented Chain surfaces.

The word "effective" carries two different meanings, so read them separately. The
per-node snapshot flag `effective` means only that an active route still reaches the
node, so the plan gives it a schedule position and an output buffer slot. It is also
`true` for a disabled node on an active route; that node is additionally reported with
`disabledBypass: true` and still occupies a buffer slot even though its zero-latency
identity bypass creates no effect instance. The published capacity limit counts effect
instances instead, so only enabled nodes with `effective: true` consume it. A node no
active route reaches is `dormant` and not effective.

- `version` is always `1`, the compile snapshot format version.
- `identity` is true when the compiled document has no nodes and no edges, making the
  stream a bit-exact, zero-latency pass-through.
- `silence` is true when the graph is not `identity`, no active route carries main
  input to the output, and no enabled node has an active outgoing route to the output,
  so the output is all zeros.

`scheduleIndex` and `bufferSlot` are `null` in JavaScript and `None` in Python
whenever the node holds no such slot: every dormant node has neither, and a `silence`
plan allocates no buffers, so every node reports a null `bufferSlot`.

Delay compensation uses latency reported by each effective instance after assets are
active. It aligns every fan-in per channel, aligns each multi-channel processing group
before its kernel, then aligns all output channels to one common maximum. Preparation
also allocates all live buffers and delay state. Processing performs no graph validation,
allocation, asset activation, lock, I/O, or WebAssembly memory growth.

## Capacity

Graph v1 publishes the implementation limits used by every binding. A document may
contain at most 128 structural nodes and
512 edges. Preparation may create at most
96 effect instances, assign at
most 129 live buffers, and reserve at most
67,108,864 bytes of workspace.
Delay lines for fan-in, pre-node processing groups, and the main output share that
workspace limit; there is no separate public delay-line quota.

## Errors

Document failures use stable `GRAPH_DOCUMENT_*` codes and a JSON path.

| Code | Meaning |
|---|---|
| `GRAPH_DOCUMENT_ID` | A missing, empty, duplicated, or otherwise invalid input, output, node, or edge ID |
| `GRAPH_DOCUMENT_REFERENCE` | An edge names an undeclared endpoint or node, the source-only input or destination-only output rule is broken, a node is not a valid effect document, a node names an unknown effect type at `/nodes/<i>/type`, or a node's `assets` are invalid at `/nodes/<i>/assets` |
| `GRAPH_DOCUMENT_CYCLE` | A self-loop or a longer cycle makes the document non-acyclic |
| `GRAPH_DOCUMENT_CONNECTIVITY` | A node or edge is off every input-to-output path, or a conversion target is not an empty or serial identity-control graph |
| `GRAPH_DOCUMENT_CHANNEL` | A node `channel` selector is invalid, or an explicit edge `pan` was supplied for a non-stereo stream layout |
| `GRAPH_DOCUMENT_EDGE_CONTROL` | An edge `gain`, `pan`, `mute`, `solo`, or `mixGroup` value is out of range or invalid for the layout |
| `GRAPH_DOCUMENT_PARAMETER` | A node parameter failed catalog validation; `path` is `/nodes/<i>/parameters/<name>`. A rejected `setParam()` / `set_param()` value reports the same code and path |

Preparation can additionally report:

| Code | Meaning |
|---|---|
| `GRAPH_CAPACITY` | A published structural-node, effective-instance, edge, live-buffer, or workspace capacity was exceeded |
| `GRAPH_INSTANCE_PREPARE` | An effective effect or required asset could not become ready before installation |
| `GRAPH_LATENCY_OVERFLOW` | A cumulative latency cannot be represented safely |
| `GRAPH_UNSUPPORTED_CAPABILITY` | The prepared configuration cannot satisfy Graph v1 processing or latency rules |
| `GRAPH_PLAN_MEMORY` | The complete immutable plan could not be allocated |

Error type does not follow the stage. Every `GRAPH_DOCUMENT_*` code and a
`GRAPH_UNSUPPORTED_CAPABILITY` raised for the document arrive as `ValidationError`
because each one is a caller-fixable document mistake; an unknown effect type arrives as
`EffectError` with the `GRAPH_DOCUMENT_REFERENCE` code, and a node whose `assets`
are missing, unknown, empty, or supplied to an effect that takes none arrives as
`AssetError` with that same code and `/nodes/<i>/assets`. A JavaScript DSP artifact
built without Graph v1 support is the one `GRAPH_UNSUPPORTED_CAPABILITY` that stays a
runtime error, because no document change fixes it. The remaining preparation codes
(`GRAPH_CAPACITY`, `GRAPH_INSTANCE_PREPARE`, `GRAPH_LATENCY_OVERFLOW`, and
`GRAPH_PLAN_MEMORY`) arrive as the runtime error type, except that an asset the
resolver cannot supply or prepare keeps `AssetError` with `GRAPH_INSTANCE_PREPARE`
and `/nodes/<i>/assets`. The class therefore follows the cause, not the stage: branch
on `code` rather than on the class when both stages must be handled together.

A rejected `setParam()` / `set_param()` reports one of three codes: a node ID absent
from the document gives `GRAPH_DOCUMENT_REFERENCE` with an empty `path`, a node the
prepared plan does not run gives `GRAPH_RECONFIGURATION_REQUIRED` with `/nodes/<i>`,
and a value the catalog rejects gives `GRAPH_DOCUMENT_PARAMETER`.

Errors include the graph path and, when applicable, the offending node or edge ID.
JavaScript uses camelCase `nodeId` and `edgeId`; Python uses `node_id` and
`edge_id`. Failed preparation installs nothing and returns no partial stream.

Document normalization and validation happen when the Graph is created or loaded. A
string passed to `Graph.load()` is JSON document text, not a path or URL. JavaScript
also loads the selected DSP artifact while creating a nonempty Graph. Native effect and
asset preparation, layout checks, latency analysis, and graph compilation happen when
`stream()` is called; offline `process()` reaches the same phase because it opens a
temporary stream. Code that recovers from Graph errors must therefore cover both Graph
creation and stream preparation.

Catch the public base error and branch on stable `code` and `path` fields. Do not
parse the human-readable message:

```js
import { EffeTuneError, createGraph } from '@effetune/dsp';

export async function processGraph(document, audio) {
  let graph;
  let stream;
  try {
    graph = await createGraph(document);
    stream = await graph.stream({ sampleRate: 48000, channels: audio.length });
    return await stream.process(audio);
  } catch (error) {
    if (!(error instanceof EffeTuneError)) throw error;
    console.error(error.code ?? error.name, error.path ?? '', error.message);
    return null;
  } finally {
    stream?.close();
    graph?.close();
  }
}
```

```python
import effetune as et

def process_graph(document, audio):
    graph = None
    stream = None
    try:
        graph = et.Graph(document)
        stream = graph.stream(48_000, channels=audio.shape[0])
        return stream.process(audio)
    except et.EffeTuneError as error:
        print(error.code or type(error).__name__, error.path or "", str(error))
        return None
    finally:
        if stream is not None:
            stream.close()
        if graph is not None:
            graph.close()
```

## Limitations

Graph v1 does not provide sidechains, key inputs, multiple node ports, multiple host I/O
buses, feedback or cycles, nested runtime graphs, physical thread parallelism, structural
editing during a stream, state-preserving plan replacement, or clickless graph switching.
It does not replace the EffeTune application's existing pipeline executor. These are
deliberate first-version boundaries, not alternate schema fields.

# Music Library scale fixtures

Scale fixtures are generated, not committed. The generator emits deterministic,
unique NDJSON rows in bounded batches, so the one-million and five-million cases
do not require a matching in-memory array.

Quick digest-only run:

```sh
node tools/library-scale/generate-catalog.mjs --size 10000 --json
```

Explicit large runs:

```sh
node tools/library-scale/generate-catalog.mjs --preset million --json
node tools/library-scale/generate-catalog.mjs --preset boundary --json
```

Add `--output <path>` only when an NDJSON file is needed. The default seed is
`0x5eed2026`, and the default batch contains 1,000 rows. Record the seed, size,
batch size, runtime version, cold/warm state, and resulting SHA-256 digest with
benchmark evidence.

`tools/library-scale/phase0-decisions.json` remains `pending` until measured
Electron and formal Web evidence satisfies every decision section. A pending
artifact is structurally valid but cannot exact-join a Phase 1 or Phase 2
consumer artifact.

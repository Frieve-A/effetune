# EffeTune DSP AudioWorklet demo

This static demo processes a user-selected audio file through
`@effetune/dsp/worklet`. `AudioContext` is created and resumed only from the
**Start processing** button. The built demo contains the package JavaScript,
worklet processor, metadata, and baseline/SIMD WebAssembly artifacts, so it
does not use a CDN or upload the selected audio.

See the [EffeTune DSP documentation](https://effetune.frieve.com/dsp/) for the
public API. The package source is maintained in
[Frieve-A/effetune](https://github.com/Frieve-A/effetune).

The public site reuses EffeTune's existing GitHub Pages deployment:

- guide: `/dsp/`
- live demo: `/dsp/demo/`
- Chain v1 schema: `/dsp/schemas/chain-v1.schema.json`
- Bundle v1 schema: `/dsp/schemas/bundle-v1.schema.json`

No separate Pages site, custom domain, or Read the Docs project is used.

Build the package and demo:

```console
cd dsp/bindings/js
npm run build
cd ../../..
node examples/dsp-library/build.mjs
```

The deterministic standalone output is written to
`examples/dsp-library/dist`. The demo itself has no server process or runtime
dependency. Browser security rules generally prevent AudioWorklet/WASM module
loading directly from `file:` URLs.

Verify that two clean builds contain identical bytes:

```console
node examples/dsp-library/build.mjs --check
```

The repository's Pages workflow generates the committed DSP documentation,
renders its complete `/dsp/` subtree with Jekyll, snapshots it, then overlays
the raw schemas and self-contained demo:

```console
node examples/dsp-library/build-site.mjs --guide _site/dsp/index.html --check
node examples/dsp-library/build-site.mjs --guide _site/dsp/index.html --output _site/dsp
```

`build-site.mjs` snapshots before replacing `_site/dsp`, so input and output
never overlap. `verify-site-stage.mjs` then checks launch routes, all catalog
effect pages, anchors and internal links, raw JSON, release notices, install
visibility, and the snapshot manifest before Pages upload.

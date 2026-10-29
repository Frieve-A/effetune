These three unmodified headers are from Google Oboe tag `1.10.0`,
`src/flowgraph/resampler/`. They provide the private declaration needed by the
decoder-thread adapter to call the resampler already present in the pinned
Oboe 1.10.0 prefab library; no second resampler implementation is compiled.

Source: https://github.com/google/oboe/tree/1.10.0/src/flowgraph/resampler

The headers and binary must be updated together. Android acceptance checks
chunk continuity, duration, stereo isolation and downsampling alias rejection.
Apache-2.0 notices remain in each header and the app's `oboe-LICENSE.txt` asset.

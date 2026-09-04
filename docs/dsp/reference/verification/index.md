---
layout: dsp
title: "Verification"
description: "Verification"
lang: en
permalink: /dsp/reference/verification/
---
# Verification

The frozen wrapper reference origin is 80 JavaScript-derived effect suites,
6 native direct-double suites, and 6 production-native-promoted suites. Maintainers run:

```console
node tools/verify-dsp-library-goldens.mjs
```

See the stable [DSP Library workflow and runs](https://github.com/Frieve-A/effetune/actions/workflows/dsp-library-ci.yml).
CI acceptance summaries are temporary workflow artifacts, not public Release assets.
The repository Chromium harness uses a special `file:` flag; that exception is not a
public browser-support claim.

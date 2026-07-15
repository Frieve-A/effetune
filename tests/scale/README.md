# Scale tests

Files in this directory are intentionally excluded from the normal coverage
suite. Use the dedicated `test:library-scale:*` scripts. Large presets must be
selected explicitly; the default smoke uses 10,000 generated tracks.

The release shard is intentionally different from fixture generation. It
requires a sealed production-runtime evidence file containing the exact
million-track workload matrix, published thresholds, runtime and machine
identity, and mixed AudioWorklet measurements. The aggregate qualification
job revalidates that file; a successful command or raw storage benchmark is
not sufficient evidence.

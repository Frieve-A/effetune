# Scale tests

Files in this directory are intentionally excluded from the normal coverage
suite. Use the dedicated `test:library-scale:*` scripts. Large presets must be
selected explicitly; the default smoke uses 10,000 generated tracks.

These are manually invoked development diagnostics. They are not commit or
release gates and do not run in GitHub Actions, the normal `verify` command,
or the Pages deployment.

For a fixed-reference run, first capture the reference computer once:

```text
npm run test:library-scale:reference -- --init-manifest C:\path\reference-machine.json
```

Review and retain that manifest as the baseline identity. Run the complete
production measurement on that same computer with:

```text
npm run test:library-scale:reference -- --manifest C:\path\reference-machine.json --output C:\path\measurement.json
```

The runner generates one deterministic million-track fixture, opens it
through the production Electron utility process and Web catalog Worker, and
runs the production AudioWorklet while the Web catalog is queried. It writes
the raw observations, source commit and dirty state, fixture identity, machine
manifest identity, and all three runtime results to one JSON file.

The runner may also be used while the worktree is dirty during active
development. The output records `dirty: true`; it is an observation of the
current files rather than an exact commit. Clean and dirty runs are both
optional development diagnostics, not commit, release, `verify`, or GitHub
Actions gates.

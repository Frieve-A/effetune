# Codex Code Review Checklist

Use this checklist when reviewing changes in this repository. Lead with concrete findings and file/line references, then summarize only after risks are covered.

## Correctness

- Check whether the change implements the requested behavior without changing unrelated workflows.
- For audio processing paths, verify channel counts, interleaved buffer indexing, bypass behavior, and real-time safety.
- For Electron changes, check IPC boundaries, preload exposure, file path handling, and platform-specific behavior.
- For UI changes, check keyboard and pointer workflows, state restoration, localization hooks, and failure states.

## Performance and Safety

- Keep hot signal-processing loops readable but avoid unnecessary allocation and slow Math helpers where a ternary or `if` is clear.
- Avoid blocking work in the renderer or audio worklet.
- Treat file system, shell, and external URL handling as security-sensitive.
- Do not start local servers or desktop app sessions during review unless the user explicitly asked for that verification.

## Tests and Documentation

- Confirm relevant tests were added or updated for behavior changes.
- Confirm `npm run verify` or an appropriate narrower check was run.
- Check that English documentation was updated first for user-facing features or plugin changes.
- For localized documentation, check that GUI labels match the localized UI text and that prose reads naturally.

## Packaging

- For new shipped files or directories, confirm `package.json` `build.files` includes them when needed.
- For packaging changes, check the relevant build command or document why it was not run.

# Agent Instructions

This file replaces the former `CLAUDE.md` local agent instructions.

## Project Layout

- `effetune.html`, `effetune.css`, and `js/` contain the web application and renderer-side modules.
- `plugins/` contains effect implementations, grouped by plugin category. Update `plugins/plugins.txt` when plugin loading order or registration changes.
- `features/measurement/` contains the measurement feature, including its UI, audio utilities, and optional local helper server.
- `electron/` contains the desktop main process, preload script, IPC handlers, file handling, and window state code.
- `tests/` contains Node.js tests. CommonJS Electron tests live under `tests/cjs/`; ES module renderer and feature tests live under `tests/esm/`; shared harnesses live under `tests/helpers/`.
- `docs/` contains English documentation and localized documentation under `docs/i18n/**/`. `BUILD.md` contains developer setup, verification, and packaging notes.

## Commands

- Install dependencies with `npm install`.
- Run lint checks with `npm run lint`.
- Run the full Node.js test suite with `npm test`.
- Run the default pre-handoff verification with `npm run verify`.
- Start the Electron app with `npm start` only when the user explicitly asks for a local app run.
- Build packaged artifacts with the platform-specific `npm run build*` scripts only when packaging changes need verification or the user explicitly asks for a build.

## Agent Workflow

- Do not start or stop local servers unless the user explicitly asks you to. Assume the user will handle server startup and shutdown.
- Use `main` as the default working branch. When a task starts on `main`, remain there unless the user explicitly asks to create or switch branches; do not create a separate agent branch as an implicit safety measure.
- Before coding, identify the relevant area (`js/`, `plugins/`, `features/measurement/`, `electron/`, docs, or tests) and inspect existing patterns there.
- For complex or ambiguous work, make a short plan before editing. Keep one thread focused on one coherent task; fork or use a separate worktree only when work truly branches.
- Follow Occam's razor, KISS (Keep It Simple, Stupid), Clean Code, and DRY (Don't Repeat Yourself) as project-wide defaults. Prefer the smallest straightforward design that fully meets current requirements; keep responsibilities, names, control flow, and interfaces clear; remove unnecessary code; and consolidate duplication that represents the same knowledge or behavior.
- Avoid speculative abstractions, indirection, configurability, dependencies, and generalization. Introduce complexity only for a current, concrete need, and do not force superficially similar cases into a shared abstraction when that would make the code harder to understand.
- When planning, modifying, or implementing, ensure the expected benefit clearly outweighs the ongoing maintenance cost. Do not add code or tests solely to handle excessively minor edge cases.
- Optimize for convergence over exhaustiveness in planning and review. Once the simplest workable approach satisfies the user's stated goal and constraints, stop; leave unspecified details to implementation, and do not add requirements, steps, safeguards, tests, or further review for hypothetical concerns. Reopen the plan only if implementation encounters an actual blocker or the user changes the requirements.
- When implementing a new feature, before adding a new custom function, consider whether an existing function can be generalized or reused while keeping its purpose clear.
- Keep the code within the task's scope smart, clean, and consistently organized, as though it had just been thoughtfully refactored; address avoidable duplication and awkward structure encountered in the changed area.
- Keep changes scoped to the request. Do not refactor unrelated code while adding a feature or fixing a bug.
- Add or update tests only when they are necessary to verify changed behavior that is not already adequately covered. If a behavior is hard to test automatically, document the manual verification performed.
- Before handing work back, review the diff for regressions, risky assumptions, missing docs, and missing tests. Use `code_review.md` as the default review checklist.

## Verification Expectations

- Default verification for code changes is `npm run verify`.
- Changes to the power-saving policy, audio-pipeline lifetime, input ownership, or resume behavior must also pass `npm run test:power-browser`. This command manages its own temporary loopback server; do not start a separate server for it.
- Use `npm test` for changes that only affect tests or when lint was already run separately.
- Use `npm run lint` for documentation-adjacent JavaScript edits where tests are not relevant.
- For Electron packaging or build configuration changes, also run the relevant build or pack command when practical.
- If a recommended verification command cannot be run, state the reason and the residual risk clearly.
- Work is done when the requested behavior is implemented, relevant docs are updated, appropriate tests or checks pass, and the final diff has been reviewed.

## Commit and Push Requirements

- Commit or push only when the user explicitly requests it. Before staging, inspect `git status` and the relevant diff, and keep unrelated user changes out of the commit.
- If any DSP digest input changes (`dsp/**`, `scripts/gen-dsp-params.mjs`, or `scripts/build-dsp-wasm.mjs`), run `npm run build:dsp`, review and include every generated change (including `plugins/dsp/` artifacts, generated parameter files, and the injected worklet binding), then rerun the build and confirm it produces no further managed-file changes.
- If web runtime or precache inputs change, `sw-precache.js` may be ignored during iterative edits. Before committing, run `npm run assets:web` and include every resulting generated asset change, including `sw-precache.js`.
- Run `npm run verify` after generated files are current and before committing. Do not commit or push while required verification is failing.
- Immediately before committing, confirm the staged diff contains the full intended change and passes `git diff --cached --check`. Immediately before pushing, confirm the worktree state and the exact branch and commit being pushed.
- After pushing, inspect the GitHub Actions run for the pushed commit. Do not report the push workflow as complete until required checks pass or any remaining failure has been reported with its cause.

## Signal Processing

- For signal processing, apply code-level optimizations as long as they do not make the code hard to read.
- When implementing signal processing for effect plugins, use ternary operators or `if` statements instead of `Math.fabs`, `Math.max`, and `Math.min`, because those Math helpers are slower.

### Real-time pipeline lifetime

- Input acquisition and release are independent of the `AudioContext`, `AudioWorklet`, and effect-pipeline lifetime. Represent disabled or unavailable live input with a stereo-compatible running silent source, and connect that source before stopping or disconnecting the previous input.
- DSP demotion and suspension decisions must use the common, fresh worklet observations of input/output activity, temporal-plugin requirements, and the normal idle deadlines. Never branch DSP lifetime on the selected input-device ID; selecting **Input Device: None** changes input ownership to the silent source but must not stop processing immediately.
- Preserve processing while a source-generating effect such as Oscillator is active or a stateful tail such as reverb or delay is still producing output. After the configured silence conditions and deadlines are satisfied, the normal Monitoring or Suspended transitions remain allowed.
- Multiple tabs or application instances are unsupported. Do not add cross-instance coordination, ownership, preference arbitration, or recovery for audio input or Web configuration; the last saved preference may win and another instance may fail to acquire the device.

## Code Comments

- All in-code comments must be written in English.

## User-Facing Messages

- Do not expose developer-oriented debug messages, stack traces, internal identifiers, implementation details, or raw errors in the user interface.
- Every message shown in the user interface must be understandable and useful to a general user. Error messages must explain in plain language what went wrong and, when the user can take action, what they can do to resolve or work around the problem.
- Send developer-oriented debug messages and detailed diagnostic information to the browser's developer Console instead of displaying them to users. Developer diagnostics must not replace a clear user-facing explanation.

## Documentation Policy

- When a feature or plugin is added, update the English documentation first as the basis for all other documentation.
- Be aware that English documentation (`README.md` at the repository root and files under `docs/`) and localized documentation (`docs/i18n/**/`) may use different folder structures, hierarchy, and page organization; do not assume paths or section layouts map one-to-one across languages.
- Balance accuracy with simplicity for general users. Avoid over-explaining edge cases or weakening statements so much that the text becomes hard to read, while still keeping the description technically correct.
- Order plugins alphabetically, both by plugin category and by plugin name within a category.
  - Exception: the `Others` and `Control` categories always come last, after all other categories.

## Plugin Documentation Policy

- Write for the intended audience: this app is not aimed at music producers or professionals, but at audio enthusiasts who enjoy listening and want to shape playback to their own taste in sound quality.
- However, this app advocates an objective rather than subjective approach to enjoying audio. Do not let the goal of keeping explanations approachable make them vague or impressionistic — documentation must describe the implementation and its effect accurately.
- Below the plugin name, provide an overview describing in what scenarios and with what effect the effector is used.
- Provide a sound-enhancement guide with concrete usage examples.
- Provide a parameter explanation covering, for each parameter, what it means and how adjusting it changes the sound.
- When a visualization is present, explain how to read it.

## Translation Policy

- English is the source of truth. Translate it into Japanese, review and correct the content there, then translate from there into the other languages.
- Keep expressions that appear in English on the GUI in English; for expressions that appear in a localized language on the GUI, match them correctly in that language.
- Repeatedly verify and revise until the result reads as if originally written in fluent, native-level prose for that language, free of translationese.

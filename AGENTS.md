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
- Before coding, identify the relevant area (`js/`, `plugins/`, `features/measurement/`, `electron/`, docs, or tests) and inspect existing patterns there.
- For complex or ambiguous work, make a short plan before editing. Keep one thread focused on one coherent task; fork or use a separate worktree only when work truly branches.
- Keep changes scoped to the request. Do not refactor unrelated code while adding a feature or fixing a bug.
- Prefer adding or updating focused tests with the change. If a behavior is hard to test automatically, document the manual verification performed.
- Before handing work back, review the diff for regressions, risky assumptions, missing docs, and missing tests. Use `code_review.md` as the default review checklist.

## Verification Expectations

- Default verification for code changes is `npm run verify`.
- Use `npm test` for changes that only affect tests or when lint was already run separately.
- Use `npm run lint` for documentation-adjacent JavaScript edits where tests are not relevant.
- For Electron packaging or build configuration changes, also run the relevant build or pack command when practical.
- If a recommended verification command cannot be run, state the reason and the residual risk clearly.
- Work is done when the requested behavior is implemented, relevant docs are updated, appropriate tests or checks pass, and the final diff has been reviewed.

## Signal Processing

- For signal processing, apply code-level optimizations as long as they do not make the code hard to read.
- When implementing signal processing for effect plugins, use ternary operators or `if` statements instead of `Math.fabs`, `Math.max`, and `Math.min`, because those Math helpers are slower.

## Code Comments

- All in-code comments must be written in English.

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

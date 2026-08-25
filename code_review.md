# Code Review Checklist

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
- Do not start local servers or desktop app sessions during review unless that verification was explicitly requested.

## Tests and Documentation

- Confirm relevant tests were added or updated for behavior changes.
- Confirm `npm run verify` or an appropriate narrower check was run.
- Check that English documentation was updated first for user-facing features or plugin changes.
- For localized documentation, check that GUI labels match the localized UI text and that prose reads naturally.

## Packaging

- For new shipped files or directories, confirm `package.json` `build.files` includes them when needed.
- For packaging changes, check the relevant build command or document why it was not run.

## Commit Readiness

- Commit readiness requires a prospective tree with zero unresolved security, quality, and dependency findings. Review and resolve the complete current GitHub Security and quality alert set, all Dependabot alerts and pull requests, and every result from local CodeQL and dependency checks before committing. Existing alerts and routine dependency updates are not an allowed baseline or backlog; include their resolution in the prospective commit or an earlier local commit.
- Run actual CodeQL analysis locally against the prospective worktree with the repository's GitHub configuration and query suites for every language and build mode supported by the current host. A CodeQL build, manual pattern review, successful workflow conclusion, or later pull-request scan is not a substitute for feasible local analysis. Install and configure missing CLI tools, query packs, and ordinary access as part of commit readiness. If a slice truly requires an unavailable operating system, hardware, credential, external service, or equivalent environment, document that exact omitted slice and residual risk, then continue with all feasible analysis; do not treat a merely missing installation or configuration as impossible.
- Before staging, review changed code against these recurring CodeQL alert patterns:
  - Keep shell-interpreted `cmd.exe`, `sh`, and `{ shell: true }` invocations isolated from generic process helpers. Use a literal shell command, and pass dynamic paths or environment-derived values only as separate arguments to a known non-shell executable. Do not let a helper used for ordinary tools also accept shell commands.
  - In C++, promote an operand before multiplication when the result is stored in `std::size_t`, `std::uint64_t`, or `double`; casting the product afterward is too late. Check both production estimators and mirrored test or reference calculations.
  - Treat regular expressions applied to variable or external text as security-sensitive. Avoid nested, overlapping, or ambiguous repetitions and unbounded wildcard suffixes that can cause super-linear backtracking; prefer bounded parsing or a linear-time expression, and exercise adversarial long input in tests when the expression is non-trivial.
  - When generating JavaScript or HTML, apply context-appropriate serialization and escaping to every interpolated value. For JavaScript string literals, serialize first and escape `<`, `>`, U+2028, and U+2029; do not rely on ad hoc replacement chains.
  - Use `crypto.randomUUID()` or `crypto.getRandomValues()` for operation, session, claim, journal, and other uniqueness- or security-relevant IDs. Do not fall back to `Math.random()`.
  - Treat writes through dynamic object keys as untrusted property access. Require an allowed own key before assignment, or use a `Map` or null-prototype dictionary when arbitrary keys are intentional; do not allow `__proto__`, `constructor`, or inherited properties to mutate object shape.
  - For URL, DOM, or download changes, parse and allowlist URL schemes, require HTTPS for remote code or data, and write untrusted text with `textContent`; do not validate with substring checks or incomplete one-pass sanitizers.
  - Keep GitHub Actions `permissions` explicit and least-privilege whenever workflows or jobs are added or changed.
- Before every commit, run the owning audit and outdated checks for every dependency manifest, including `npm audit --audit-level=moderate` and `npm outdated` at the root, and inspect all open Dependabot alerts and pull requests, including GitHub Actions updates. Resolve every available update in the prospective commit or an earlier local commit. For dependency metadata changes, also run the CI-equivalent `npm ci --ignore-scripts`, `npm audit signatures`, and `npm run verify`; reject unresolved peer conflicts instead of forcing installation. Do not exempt routine or development-only updates from the commit gate.
- For GitHub Actions graph changes, run the repository's workflow syntax and pinning checks and review both selected and skipped paths. Check `needs`, job-level `if`, reusable-workflow inputs, and the required gate together; a skipped prerequisite must not silently suppress a selected validation stage.
- For every added or modified filesystem/path test, check whether the tested production path is canonicalized with `realpath`. Canonicalize a temporary root immediately after `mkdtemp`, derive expected paths from the same canonical root, and do not compare a raw `os.tmpdir()` path with a canonicalized production path. Prefer `await fs.realpath(await fs.mkdtemp(...))` when the temporary root enters production path checks. Avoid mocks that match filesystem calls using only `path.resolve()` or case-folded strings when production uses `realpath`; prefer a real file, including a sparse file for size-limit tests, or canonicalize both operands identically. This prevents macOS `/var` versus `/private/var` failures and Windows short-path mismatches that may not reproduce on the development machine.
- If a C++ source or header under `dsp/` changed, format the changed files before rebuilding DSP artifacts. Then run the same non-vendor check as the DSP Core workflow with a clang-format version that accepts `.clang-format`:

  ```bash
  find dsp -path dsp/vendor -prune -o \( -name '*.cpp' -o -name '*.h' \) -print0 | xargs -0 clang-format --dry-run --Werror
  ```

  On Windows PowerShell, run the equivalent recursive check:

  ```powershell
  Get-ChildItem dsp -Recurse -File |
    Where-Object { $_.Extension -in '.cpp', '.h' -and $_.FullName -notmatch '[\\/]dsp[\\/]vendor[\\/]' } |
    ForEach-Object { clang-format --dry-run --Werror $_.FullName }
  ```

  Use the current Visual Studio LLVM `clang-format.exe` if the executable on `PATH` is too old. Treat an unsupported `.clang-format` option or other configuration error as a failed check. `npm run verify` does not run this C++ formatting check.
- For C++ changes, also run the CodeQL manual build in a Linux/GCC environment when available; an MSVC build does not cover GCC `-Werror` diagnostics:

  ```bash
  cmake -S dsp -B out/dsp/codeql -G Ninja -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON
  cmake --build out/dsp/codeql --parallel
  ```

  If the environment is unavailable, note the residual CI risk and confirm the GitHub Actions result before treating the publish workflow as successful.
- Run `npm run build:dsp` after C++ formatting or any other DSP digest-input change, include all generated changes, rerun it, and confirm the second run produces no further managed-file changes.
- Regenerate affected parity goldens whenever DSP behavior or a golden-defining reference, case, policy, tolerance, or revision input changes—not only when a C++ kernel changes. After the build, run both `npm run test:dsp -- --native-build-type=Debug` and `npm run test:dsp -- --native-build-type=Release`, then `npm run test:dsp:parity`. Exercise exact native parity on every available CI-equivalent compiler or architecture and report unavailable platforms as residual risk rather than weakening a comparison from CI alone.
- When a DSP binding, generated cross-language contract, or a non-Node test changes, run the owning package and acceptance tests too. `npm test` does not execute Python wheel tests, native CTest, or installed-package acceptance.
- Run `npm run assets:web` when web runtime or precache inputs changed, then run `npm run verify` after all generated files are current.
- Use a restartable commit-readiness loop: update required generated files → install or configure missing check tooling → run required verification → run every GitHub Security and quality, Dependabot/dependency, and local CodeQL check feasible on the current host → resolve every result → record only genuinely impossible checks and their exact uncovered scope → stage intended changes → review the cached diff and run `git diff --cached --check` → confirm no feasible finding, update, or intended change is omitted → commit. Any edit caused by these checks invalidates earlier generation, analysis, and verification results, so return to generated-file updates and repeat the loop before committing. Immediately before pushing, confirm the branch and exact commit. After pushing, monitor every GitHub Actions workflow and alert surface triggered by that commit through completion and confirm the committed resolutions are reflected on GitHub before treating the change as landed.

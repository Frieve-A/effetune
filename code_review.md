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
- Do not start local servers or desktop app sessions during review unless the user explicitly asked for that verification.

## Tests and Documentation

- Confirm relevant tests were added or updated for behavior changes.
- Confirm `npm run verify` or an appropriate narrower check was run.
- Check that English documentation was updated first for user-facing features or plugin changes.
- For localized documentation, check that GUI labels match the localized UI text and that prose reads naturally.

## Packaging

- For new shipped files or directories, confirm `package.json` `build.files` includes them when needed.
- For packaging changes, check the relevant build command or document why it was not run.

## Commit Readiness

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
  cmake -S dsp -B dsp/build/codeql -G Ninja -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON
  cmake --build dsp/build/codeql --parallel
  ```

  If the environment is unavailable, record the residual CI risk and wait for the GitHub Actions result before reporting the publish workflow as successful.
- Run `npm run build:dsp` after C++ formatting or any other DSP digest-input change, include all generated changes, rerun it, and confirm the second run produces no further managed-file changes.
- Run `npm run assets:web` when web runtime or precache inputs changed, then run `npm run verify` after all generated files are current.
- Use a restartable commit-readiness loop: update required generated files → run required verification → stage intended changes → review the cached diff and run `git diff --cached --check` → confirm no intended change remains unstaged → commit. Any edit caused by these checks invalidates earlier generation and verification results, so return to generated-file updates and repeat the loop before committing. Immediately before pushing, confirm the branch and exact commit. After pushing, monitor every GitHub Actions workflow triggered by that commit through completion and investigate any failure before reporting success.

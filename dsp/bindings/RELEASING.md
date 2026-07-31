# DSP library publication setup

This is the one-time operator setup for
`.github/workflows/dsp-library-release.yml`. The workflow is intentionally
inert unless it runs in `Frieve-A/effetune` at a validated
`refs/tags/dsp-vX.Y.Z` ref. The tag version must exactly match both package
versions. The first planned DSP library release is `dsp-v0.1.0`; do not create
or push it until every required CI check passes on the intended commit and the
registry setup below is complete.

## Confirmed publication identities

| Surface | Identity |
|---|---|
| PyPI project | `effetune` |
| Python import | `effetune` |
| npm package | `@effetune/dsp` |
| Documentation | `https://effetune.frieve.com/dsp/` |
| GitHub repository | `https://github.com/Frieve-A/effetune` |

## Registry ownership

1. Confirm that the `effetune` PyPI project and the `@effetune` npm scope are
   controlled by the project owner. Do not rely on the 2026-07-28 availability
   check.
2. Complete any registry-required first-owner or scope bootstrap manually.
   The release workflow does not create registry accounts, organizations, or
   package ownership.
3. Do not add PyPI or npm write tokens to GitHub. Both publish jobs use OIDC
   trusted publishing.

As of 2026-07-29, PyPI was signed out and had no pending publisher configured.
Log in before creating the pending publisher described below. The npm
organization existed with two-factor authentication enforced but no package
in the scope. npm only allows a trusted publisher to be configured after the
package exists, so the owner must complete a separately reviewed and explicitly
approved initial package bootstrap before enabling the automated npm release.
Do not push a release tag while either publisher is unavailable.

## Protected GitHub environments

Create these repository environments and require an owner review:

| Environment | Purpose |
|---|---|
| `pypi` | Approves the irreversible PyPI upload |
| `npm` | Approves the irreversible npm upload |

Restrict each environment to protected `dsp-v*` release tags and require an
owner review. Keep environment secrets empty; OIDC uses short-lived identity
tokens. The GitHub Release job deliberately has no environment and starts only
after both registry publication jobs succeed.

## PyPI trusted publisher

Configure a pending or existing-project GitHub trusted publisher with:

- Owner: `Frieve-A`
- Repository: `effetune`
- Workflow: `dsp-library-release.yml`
- Environment: `pypi`
- Project: `effetune`

The workflow uses `pypa/gh-action-pypi-publish@release/v1`. PyPI publication
attestations are produced by that action under the trusted-publisher identity.

## npm trusted publisher

After `@effetune/dsp` exists in the registry, configure its GitHub Actions
trusted publisher for:

- Organization/user: `Frieve-A`
- Repository: `effetune`
- Workflow: `dsp-library-release.yml`
- Environment: `npm`

The publish job runs on a GitHub-hosted runner with Node.js 24 and npm's OIDC
flow. npm trusted publishing requires npm 11.5.1 or newer and Node.js 22.14.0
or newer. Provenance is attached automatically for a public package published
from a public repository.

## Release procedure

1. Confirm `dsp/bindings/python/pyproject.toml` and
   `dsp/bindings/js/package.json` contain the same `<version>`. For the first
   planned DSP library release, `<version>` is `0.1.0`.
2. Confirm DSP Library CI is green, including all wheel platforms, clean
   installed package tests, npm preset rendering, golden parity, codegen drift,
   and the reproducible demo. Confirm the existing Pages workflow also stages
   the guide, schemas, and demo under `/dsp/`.
3. Review the exact commit and create the tag explicitly:

   ```console
   git tag -s dsp-v<version> <verified-commit-sha>
   git push origin dsp-v<version>
   ```

4. Review the build logs and the assembled
   `dsp-v<version>-publication-candidate`
   artifact before approving either registry environment.
5. Approve `pypi` and `npm` only when the filenames, wheel tags,
   checksums, SPDX SBOM, and attestations match the reviewed commit.
6. Confirm the GitHub Release is created automatically after both registry
   uploads succeed.

`workflow_dispatch` is only a recovery entry point. It must be launched with
the existing `dsp-v<version>` tag selected as the ref; a branch run is rejected
by the release gate.

## Verification

Download the publication candidate before approval and inspect:

- CPython 3.10 and 3.11 version-specific wheels for Windows, macOS, and Linux;
- `cp312-abi3` wheels for those three operating systems;
- the `@effetune/dsp` npm tarball;
- `SHA256SUMS` and `SBOM.spdx.json`.

After publication, verify GitHub provenance on a downloaded artifact:

```console
gh attestation verify <artifact-path> --repo Frieve-A/effetune
```

PyPI and npm releases are immutable. If any artifact or metadata is wrong, do
not approve publication and do not reuse the version; fix the source and
choose the next version and matching tag.

## Documentation deployment

The public guide, schemas, and live demo are part of the repository's existing
GitHub Pages site at `https://effetune.frieve.com/dsp/`. The root
`.github/workflows/pages.yml` workflow renders the guide with Jekyll and stages
the schemas and CDN-free demo under the same `_site/dsp/` directory. It reuses
the existing custom domain and `github-pages` environment; do not create a
separate Pages site, domain, or documentation environment.

Read the Docs is not used. Documentation deployment follows updates on the
site's normal branch and is independent of the tag-triggered registry release.

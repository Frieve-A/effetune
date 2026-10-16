# Releasing effetune-mcp

What it takes for users to run `npx -y effetune-mcp setup`: the package has to be on the npm
registry. `.github/workflows/mcp.yml` publishes it when a tag `mcp-v<version>` is pushed.

## One-time preparation

1. **Trusted publisher.** The initial `effetune-mcp@0.1.0` release is already on npm.
   In its npm Settings > Trusted publishing, add GitHub Actions with user `Frieve-A`,
   repository `effetune`, workflow filename `mcp.yml`, and environment `npm`. Enable
   **Allow npm publish**. No `NPM_TOKEN` secret or local npm login is needed for CI publication.
2. **GitHub environment.** The repository's `npm` environment must allow the `mcp-v*` tag
   pattern alongside `dsp-v*`. Retain its existing reviewer protection.
3. **Workflow.** Use the public `Frieve-A/effetune` repository and Node.js 24 in the publish
   job, with `id-token: write` and the matching `npm` environment. Keep `repository.url`
   aligned with that repository so npm can generate provenance.
4. Complete the first successful publication within two days of registering the trusted
   publisher; otherwise recreate the expired registration. See the
   [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

## Each release

1. Merge the work into `main` (the tag must point at a commit that contains
   `.github/workflows/mcp.yml`) and check that the **MCP server** workflow passed on it.
2. For future MCP releases, match the minor and patch (`y.z`) to the app's `x.y.z` in the root
   `package.json`, keeping the MCP major independent (for example, app `2.15.0` → MCP `0.15.0`).
   Update `mcp/package.json` and `mcp/package-lock.json` together and verify this alignment before
   committing and publishing. Already published versions remain unchanged.
3. Complete the repository's commit/push verification gates. Tag the verified release commit
   and push only that tag; the tag must equal `mcp-v` plus the version:

   ```sh
   git tag mcp-v0.15.0
   git push origin mcp-v0.15.0
   ```

4. Watch Actions > **MCP server**. After `Test` passes, verify the release commit, package
   contents, version alignment, and tag before approving the pending `npm` environment
   deployment. When the user has authorized publication, the agent may perform this GitHub
   approval without asking again. Request user action only when authentication or permissions
   require it. `Publish to npm with trusted publishing` checks the tag against `package.json`
   and publishes with provenance.
5. Check the result:

   ```sh
   npm view effetune-mcp version
   npx -y effetune-mcp@latest setup --help
   ```

An app release does not automatically require an MCP release: the server reads effects and
parameters from the running app. For an explicitly requested combined DSP/MCP release, complete
the DSP release first, then push the MCP tag separately and verify its publication. Skip an
already published version rather than attempting to publish it again.

## If a release went wrong

- The tag and version disagree: the publish job stops before publishing. Delete the tag
  (`git push origin :refs/tags/mcp-vX.Y.Z`, `git tag -d mcp-vX.Y.Z`), fix, and tag again.
- A published version is broken: npm never accepts the same version twice. Publish a fixed
  version, then mark the broken one: `npm deprecate effetune-mcp@X.Y.Z "use X.Y.Z+1"`.
  `npm unpublish` is only allowed within 72 hours and blocks the version number for good.
- Authentication failed: check the npm trusted publisher's repository, workflow filename,
  environment, direct-publish permission, and expiry against the workflow. Fix the diagnosed
  cause before retrying; do not introduce a long-lived token as a workaround.

## What users need

- Node.js 20 or later (for `npx`).
- EffeTune desktop with Remote Control (2.13.0 or later). `describe_effects` also needs an app
  with the `describe1` feature, which comes from `js/remote/effect-describe.js`; until that is in
  an EffeTune release, users of the upstream app get every tool except `describe_effects`.
- Then: Settings > Remote Control > on, **Copy link**, and `npx -y effetune-mcp setup`.

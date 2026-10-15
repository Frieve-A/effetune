# Releasing effetune-mcp

What it takes for users to run `npx -y effetune-mcp setup`: the package has to be on the npm
registry. `.github/workflows/mcp.yml` publishes it when a tag `mcp-v<version>` is pushed.

## One-time preparation

1. **npm account.** Sign in at <https://www.npmjs.com> (create an account if needed) and turn on
   two-factor authentication. Check that the name is still free: `npm view effetune-mcp` should
   answer `404 Not Found`.
2. **Access token.** npmjs.com > Access Tokens > Generate New Token > *Granular Access Token*:
   - Permissions: *Read and write* for packages. A token cannot be limited to a package that does
     not exist yet, so for the first release choose all packages, and after it narrow a new token
     to `effetune-mcp` only.
   - Allow it to publish without a one-time password (*Bypass two-factor authentication*), since
     the workflow cannot type one.
   - Give it an expiry date and note it.
3. **Repository secret.** On GitHub, the repository > Settings > Secrets and variables >
   Actions > New repository secret: name `NPM_TOKEN`, value the token.
4. **Actions enabled.** In a fork, Actions start disabled: open the Actions tab and enable
   workflows.
5. **Public repository.** `npm publish --provenance` only works from a public repository whose URL
   matches `repository.url` in `mcp/package.json` (`https://github.com/Frieve-A/effetune`).

## Each release

1. Merge the work into `main` (the tag must point at a commit that contains
   `.github/workflows/mcp.yml`) and check that the **MCP server** workflow passed on it.
2. Set the version in `mcp/package.json` (semver: a fix raises the patch, a new tool or option
   the minor), run `npm install` in `mcp/` so `package-lock.json` follows, and commit.
3. Tag that commit and push the tag; the tag must equal `mcp-v` plus the version:

   ```sh
   git tag mcp-v0.1.0
   git push origin mcp-v0.1.0
   ```

4. Watch Actions > **MCP server**: the `Test` job runs, then `Publish to npm` checks the tag
   against `package.json` and publishes with provenance.
5. Check the result:

   ```sh
   npm view effetune-mcp version
   npx -y effetune-mcp@latest setup --help
   ```

An app release needs no MCP release: the server reads effects and parameters from the running
app. Release the MCP server only when files in `mcp/` change.

## If a release went wrong

- The tag and version disagree: the publish job stops before publishing. Delete the tag
  (`git push origin :refs/tags/mcp-vX.Y.Z`, `git tag -d mcp-vX.Y.Z`), fix, and tag again.
- A published version is broken: npm never accepts the same version twice. Publish a fixed
  version, then mark the broken one: `npm deprecate effetune-mcp@X.Y.Z "use X.Y.Z+1"`.
  `npm unpublish` is only allowed within 72 hours and blocks the version number for good.
- The token leaked or expired: revoke it on npmjs.com, create a new one and replace the
  `NPM_TOKEN` secret.

## What users need

- Node.js 20 or later (for `npx`).
- EffeTune desktop with Remote Control (2.13.0 or later). `describe_effects` also needs an app
  with the `describe1` feature, which comes from `js/remote/effect-describe.js`; until that is in
  an EffeTune release, users of the upstream app get every tool except `describe_effects`.
- Then: Settings > Remote Control > on, **Copy link**, and `npx -y effetune-mcp setup`.

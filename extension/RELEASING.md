# Browser extension releases

The **Browser Extension Release** workflow builds the existing Manifest V3
extension, signs a Chrome CRX with your existing upload key, and uploads updates
to the existing Chrome and Edge listings. It uses the root `package.json` version,
just like the desktop release.

## Release behavior

- Pushing an exact `v<package.json version>` tag to `Frieve-A/effetune` runs source
  verification, builds the extension, and tests tab audio in Chromium. Only after
  these pass do the Chrome and Edge jobs upload and submit for review. Approved
  updates are published using the stores' existing distribution settings.
- The workflow runs independently of desktop packaging. Desktop, DSP Library,
  and MCP release workflows keep their existing behavior. `dsp-v*` and `mcp-v*`
  tags do not trigger extension releases.
- **Run workflow** supports `store: both`, `chrome`, or `edge`. Select the exact
  release tag as the workflow ref to submit for review. The `submit` checkbox
  defaults to **off**, which uploads a draft without submitting it for review.
  A manual run on `main` is also allowed with `submit` off, for initial setup
  testing before creating a release tag. Other branches, and submission from
  `main`, fail before upload.
- Store jobs run independently, so a Chrome failure does not prevent Edge from
  submitting, or vice versa. Missing credentials fail the selected store job.
- The `extension-package` artifact contains the unpacked extension and ZIP.
  `chrome-extension-crx` contains the signed CRX. Both are kept for 30 days.
  These are Actions artifacts, not GitHub Release attachments.

Submission success does not mean the store review has finished. Check the
Developer Dashboard and Partner Center for approval, rejection, or publication.
The workflow polls upload processing and Edge submission creation for up to ten
minutes each; it does not wait through store certification.

## One-time setup

The Chrome and Edge listings must already exist. Description text, screenshots,
privacy declarations, and other listing metadata remain managed in their store
dashboards.

### Chrome CRX signing

1. Locate the **existing `.pem` private key** that you select in Chrome's
   **Pack extension** dialog. Keep using this key.
2. In the Chrome Web Store Developer Dashboard, open EffeTune's **Package** tab.
   If **Verified CRX Uploads** is enabled, its registered public key must match
   this private key. Do not generate a replacement key just for Actions.
3. Register the entire PEM text, including the BEGIN/END lines and real line
   breaks, as the repository secret `CHROME_CRX_PRIVATE_KEY`. No Base64 encoding
   is needed.

The workflow always signs a CRX, so it supports Verified CRX Uploads without
disabling that setting. Chrome runs with an isolated temporary profile. The
private key is written beside, never inside, the temporary extension directory,
and removed after packaging, including on failure. It is not included in an
artifact. The hosted Ubuntu runner supplies Google Chrome.

See [Chrome's signing and API upload instructions](https://developer.chrome.com/docs/webstore/update#protect-your-package-updates).

### Chrome API authentication

This uses a **Google Cloud service account**, a separate key from the CRX signing
key above.

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create
   a project and enable **Chrome Web Store API**.
2. Create a service account. No broad project IAM role or domain-wide delegation
   is needed for this integration.
3. In the Chrome Web Store Developer Dashboard, add that service account's email
   under the publisher account settings, as described in
   [Google's service account guide](https://developer.chrome.com/docs/webstore/service-accounts).
4. In Google Cloud, open the service account's **Keys → Add key → Create new
   key → JSON**. Register the complete downloaded JSON as the repository secret
   `CHROME_WEB_STORE_SERVICE_ACCOUNT`.
5. Copy the **Publisher ID** from **Publisher → Settings** in the Developer
   Dashboard into the repository variable `CHROME_WEB_STORE_PUBLISHER_ID`.

The workflow targets EffeTune's existing Chrome item,
`fhjhnpepnhkcdggogicifibfegpbhibp`. It exchanges a signed service account
assertion for a short-lived OAuth access token with the `chromewebstore` scope.
It calls Chrome Web Store API **v2**; no personal refresh token is required.
If your Google Cloud organization prohibits creating service account keys, an
administrator must permit a dedicated key or configure a separate keyless
authentication integration before this workflow can authenticate.

### Edge API authentication

1. Sign in to [Partner Center](https://partner.microsoft.com/dashboard) with the
   account that owns the published Edge extension.
2. Under **Microsoft Edge → Publish API**, enable the API-key experience and
   choose **Create API credentials**.
3. Register the API key as the repository secret `EDGE_ADDONS_API_KEY`, and the
   Client ID as the repository variable `EDGE_ADDONS_CLIENT_ID`.
4. Open EffeTune's extension overview and copy its **Product ID** into the
   repository variable `EDGE_ADDONS_PRODUCT_ID`. This is a GUID from Partner
   Center, not the `kjpcfdidpphaclfkfdahchhibgjcngdk` ID in the public store URL.
5. Record the API key's expiry date and replace the secret when renewing it.

This uses the **v1.1 API-key authentication** (`Authorization: ApiKey` and
`X-ClientID`); Microsoft's endpoint paths still start with `/v1/`.
See [Microsoft's API setup instructions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api).

### GitHub settings

In **Frieve-A/effetune → Settings → Secrets and variables → Actions**, register:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `CHROME_CRX_PRIVATE_KEY` | Existing CRX signing PEM, complete text |
| Secret | `CHROME_WEB_STORE_SERVICE_ACCOUNT` | Complete Google service account JSON |
| Secret | `EDGE_ADDONS_API_KEY` | Partner Center API key |
| Variable | `CHROME_WEB_STORE_PUBLISHER_ID` | Chrome publisher ID |
| Variable | `EDGE_ADDONS_CLIENT_ID` | Partner Center Publish API Client ID |
| Variable | `EDGE_ADDONS_PRODUCT_ID` | Partner Center product GUID |

Store private keys outside the repository and retain secure backups. Do not put
them in a commit, issue, or workflow input. Secrets are passed only to their
respective signing or upload step; the verification job has no store credentials.

## First run and subsequent releases

1. Land the workflow and scripts before creating the next release tag. An old
   tag whose commit predates these files cannot run the new release workflow.
2. Complete the settings above before pushing that tag. A tag push submits to
   **both stores automatically**; use manual dispatch for an upload-only trial.
3. To try a draft before the next tag push, ensure `main` has a version newer
   than the version in the selected store. Run **Browser Extension Release**,
   select `main`, choose a store, and leave **submit** unchecked. This changes the
   store draft but does not start review.
4. Inspect the draft. You can submit that draft from the dashboard when ready.
   Use a new, higher version for the next automated release after publication.

For manual dispatch with the GitHub CLI:

```powershell
gh workflow run extension-release.yml --repo Frieve-A/effetune --ref main -f store=both -f submit=false
gh workflow run extension-release.yml --repo Frieve-A/effetune --ref vX.Y.Z -f store=chrome -f submit=true
```

Replace `vX.Y.Z` with the actual release tag. The web UI's ref selector may show
only branches; the CLI can select a tag directly.

If one store fails, first inspect its dashboard to determine whether the upload
or submission was accepted. A network timeout can leave an accepted operation
running. Use **Re-run failed jobs**, or manually select only that store. Do not
rerun a successful store job after publishing the same version; stores require
version increments for updates. If upload succeeded but submission failed,
resolve the store's validation error and submit the existing draft there.

The API does not bypass review. Chrome validation warnings fail submission for
inspection in the dashboard. The script never retries a write automatically,
and it does not cancel an existing review or overwrite listing metadata.

## Local commands

`npm run build:extension` still creates `out/extension/` and
`out/effetune-extension-<version>.zip`. To sign locally, supply
`CHROME_CRX_PRIVATE_KEY` and optionally `CHROME_PATH` (the full Chrome executable
path on Windows), then run:

```text
node scripts/release-extension.mjs sign
```

The `chrome` and `edge` commands use the same environment variable names as the
workflow. Set `CHROME_WEB_STORE_EXTENSION_ID` to the existing item ID for local
Chrome uploads. They upload a draft by default; setting `EXTENSION_SUBMIT=true`
also requests review and publication. Use them only when an upload is intended.
The scripts require Node.js 22 and built packages, with no additional npm
dependencies. Run `npm run test:extension-browser` after packaging changes.

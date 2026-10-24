import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

// Chromium stores user-added server trust in the profile, independently of the OS:
// https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/net/server_certificate_database_service_factory.cc
// Schema: https://raw.githubusercontent.com/chromium/chromium/main/components/server_certificate_database/server_certificate_database.cc
// Metadata: https://raw.githubusercontent.com/chromium/chromium/main/components/server_certificate_database/server_certificate_database.proto
export async function createTrustedChromeProfile(certificatePath) {
  const parent = await realpath(os.tmpdir());
  const directory = await realpath(await mkdtemp(path.join(parent, 'effetune-pwa-chrome-')));
  const profile = path.join(directory, 'profile');
  const options = { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--lang=en-US'] };
  let context;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await context?.close();
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith('effetune-pwa-chrome-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    context = await chromium.launchPersistentContext(profile, options);
    const setup = await context.newPage();
    await setup.goto('chrome://certificate-manager/localcerts/usercerts');
    await setup.getByRole('button', { name: 'Import to Trusted Certificates', exact: true }).waitFor();
    await context.close(); context = null;
    const databasePath = path.join(profile, 'Default', 'ServerCertificate');
    const database = new DatabaseSync(databasePath);
    const der = new X509Certificate(await readFile(certificatePath)).raw;
    const hash = createHash('sha256').update(der).digest('hex');
    try {
      assert.deepEqual(database.prepare('PRAGMA table_info(certificates)').all().map(column => column.name), ['sha256hash_hex', 'der_cert', 'trust_settings']);
      assert.equal(database.prepare('SELECT count(*) AS count FROM certificates').get().count, 0);
      // CertificateMetadata { trust { trust_type: CERTIFICATE_TRUST_TYPE_TRUSTED } }.
      database.prepare('INSERT INTO certificates(sha256hash_hex, der_cert, trust_settings) VALUES (?,?,?)').run(hash, der, Buffer.from([10, 2, 8, 3]));
      assert.deepEqual(Buffer.from(database.prepare('SELECT der_cert FROM certificates WHERE sha256hash_hex = ?').get(hash).der_cert), der);
    } finally { database.close(); }
    context = await chromium.launchPersistentContext(profile, options);
    const verification = await context.newPage();
    await verification.goto('chrome://certificate-manager/localcerts/usercerts');
    await verification.getByRole('textbox').first().waitFor();
    assert.equal(await verification.getByRole('textbox').first().inputValue(), hash);
    await verification.close();
    return { context, browser: context.browser(), directory, databasePath, close };
  } catch (error) { await close(); throw error; }
}

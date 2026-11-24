const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const access = require('../../electron/file-access.cjs');

test('file grants enforce explicit selection, settings names and canonical output boundaries', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-access-')));
  const settings = path.join(root, 'settings');
  const output = path.join(root, 'output');
  fs.mkdirSync(settings);
  fs.mkdirSync(output);
  const selected = path.join(root, 'selected.wav');
  const secret = path.join(root, 'secret.txt');
  fs.writeFileSync(selected, 'audio');
  fs.writeFileSync(secret, 'private');
  try {
    assert.throws(() => access.assertPath(secret, 'read', settings));
    access.grantRead(selected);
    access.assertPath(selected, 'read', settings);
    assert.throws(() => access.assertPath(selected, 'write', settings));
    access.grantWrite(selected);
    access.assertPath(selected, 'write', settings);
    access.grantOutputDirectory(output);
    access.assertPath(path.join(output, 'processed.wav'), 'write', settings);
    assert.throws(() => access.assertPath(path.join(output, '..', 'secret.txt'), 'write', settings));
    assert.throws(() => access.assertPath(secret, 'read', settings));
    access.assertPath(path.join(settings, 'effetune_presets.json'), 'write', settings);
    access.assertPath(path.join(settings, 'pipeline-state.json'), 'read', settings);
    assert.throws(() => access.assertPath(path.join(settings, 'pipeline-state.json'), 'write', settings));
    assert.throws(() => access.assertPath(path.join(settings, 'config.json'), 'read', settings));
    // Junctions are available without Windows symlink privileges.
    fs.symlinkSync(settings, path.join(output, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => access.assertPath(path.join(output, 'redirect', 'config.json'), 'write', settings));
    access.clear();
    assert.throws(() => access.assertPath(selected, 'read', settings));
  } finally {
    access.clear();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('only the current main frame can request file access', () => {
  const webContents = { mainFrame: {} };
  const main = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  access.assertSender(event, main);
  for (const denied of [{}, { ...event, sender: {} }, { ...event, senderFrame: {} }]) {
    assert.throws(() => access.assertSender(denied, main));
  }
  assert.throws(() => access.assertSender(event, { ...main, isDestroyed: () => true }));
});

test('session paths preserve the original grant across restarts and named profile markers stay in their directory', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-session-access-')));
  t.after(() => { access.clear(); fs.rmSync(root, { recursive: true, force: true }); });
  const profile = path.join(root, 'profile');
  const original = path.join(root, 'selected');
  const replacement = path.join(root, 'replacement');
  for (const directory of [profile, original, replacement]) fs.mkdirSync(directory);
  const selected = path.join(original, 'song.mid');
  const marker = path.join(profile, 'player-session-marker.json');
  fs.writeFileSync(selected, 'music');
  const canonical = fs.realpathSync(selected);
  access.assertPath(marker, 'write', root, profile);
  assert.throws(() => access.assertPath(path.join(root, 'player-session-marker.json'), 'write', root, profile));
  assert.equal(access.getGrantedReadPath(marker), null);
  access.grantRead(selected);
  fs.renameSync(original, path.join(root, 'moved'));
  fs.symlinkSync(replacement, original, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(replacement, 'song.mid'), 'replacement');
  const saved = access.getGrantedReadPath(selected);
  assert.equal(saved, canonical);
  access.clear();
  access.restoreGrantedReadPath(saved);
  assert.equal(access.getGrantedReadPath(saved), canonical);
  assert.throws(() => access.assertPath(saved, 'read', root, profile));
});

test('session paths keep canonical filename case across grant and restore', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-session-path-')));
  t.after(() => { access.clear(); fs.rmSync(root, { recursive: true, force: true }); });
  const selected = path.join(root, 'Song.mid');
  fs.writeFileSync(selected, 'music');
  const canonical = fs.realpathSync(selected);
  const lookup = process.platform === 'win32' ? selected.toLowerCase() : selected;
  access.grantRead(selected);
  const saved = access.getGrantedReadPath(lookup);
  assert.equal(saved, canonical);
  access.clear();
  access.restoreGrantedReadPath(saved);
  assert.equal(access.getGrantedReadPath(lookup), canonical);
  access.assertPath(saved, 'read', root);
});

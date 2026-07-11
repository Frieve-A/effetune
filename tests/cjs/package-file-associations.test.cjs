const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('packaged app registers MP4 files as audio', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  const association = packageJson.build.fileAssociations.find(({ ext }) => ext === 'mp4');

  assert.deepEqual(association, {
    ext: 'mp4',
    name: 'MP4 Audio',
    description: 'MP4 Audio File',
    icon: 'icon',
    role: 'None'
  });
});

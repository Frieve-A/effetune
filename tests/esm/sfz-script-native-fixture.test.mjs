import test from 'node:test';
import { updateSfzScriptFixture } from '../../tools/generate-sfz-script-fixture.mjs';

test('native script audio fixture matches the independent source compiler', () => {
  updateSfzScriptFixture({ check: true });
});

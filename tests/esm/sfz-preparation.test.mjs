import test from 'node:test';
import { generateSfzPreparationFixture } from '../../tools/generate-sfz-preparation-fixture.mjs';
test('native typed preparation fixture uses current compiler and exact memory estimate', async () => {
  await generateSfzPreparationFixture({ check: true });
});

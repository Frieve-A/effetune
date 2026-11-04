import test from 'node:test';
import { updateSf2NativeFixture } from '../../tools/generate-sf2-native-fixture.mjs';
test('native SF2 collection fixture matches the bounded source parser and shared packer', async () => {
    await updateSf2NativeFixture({ check: true });
});

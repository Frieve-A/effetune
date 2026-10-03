import assert from 'node:assert/strict';
import test from 'node:test';
import { guardPluginsForClientCsp } from '../../js/remote/client-csp-guards.js';

test('Cassette Artifacts never schedules its eval-based status measurement on the client', () => {
    let scheduled = 0;
    class Cassette { _scheduleNrQuietingUpdate() { scheduled += 1; } }
    class Other { _scheduleNrQuietingUpdate() { scheduled += 100; } }
    guardPluginsForClientCsp({ pluginClasses: { 'Cassette Artifacts': Cassette, Other } });
    new Cassette()._scheduleNrQuietingUpdate();
    new Other()._scheduleNrQuietingUpdate();
    assert.equal(scheduled, 100);
});

test('the guard tolerates a plugin set without Cassette Artifacts', () => {
    guardPluginsForClientCsp({ pluginClasses: {} });
    guardPluginsForClientCsp({});
});

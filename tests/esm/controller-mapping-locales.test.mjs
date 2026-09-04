import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
const buttonModeKeys = ['midi.buttonMode', 'midi.buttonMode.toggle', 'midi.buttonMode.momentary'];
const configKeys = ['dialog.config.physicalControl', 'midi.openSettings'];
const persistenceKeys = ['error.controllerMappingSaveFailed'];
const availabilityKeys = ['midi.notSupported', 'midi.permissionDenied', 'midi.driverStalled'];
const fieldLabelKeys = [
  'midi.target.type',
  'midi.target.instance',
  'midi.target.parameter',
  'midi.direction',
  'midi.mode'
];
const automationKeys = [
  'midi.addAutomation',
  'midi.automation.source.timer',
  'midi.automation.source.clock',
  'midi.clock.component.hour',
  'midi.clock.component.minute',
  'midi.clock.component.second',
  'midi.clock.shape.ramp',
  'midi.clock.shape.sin',
  'midi.clock.shape.cos',
  'midi.timer.interval',
  'midi.behavior.direct',
  'midi.behavior.random',
  'midi.behavior.randomWalk',
  'midi.automation.amount',
  'midi.timer.schedule',
  'midi.timer.schedule.interval',
  'midi.timer.schedule.once',
  'midi.timer.schedule.daily',
  'midi.timer.date',
  'midi.timer.time',
  'midi.timer.expired'
];
const timerSummaryKeys = [
  'midi.source.timer.interval',
  'midi.source.timer.once',
  'midi.source.timer.daily'
];

function localeValue(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`"${escaped}":\\s*"([^"]+)"`).exec(source)?.[1];
}

test('controller button-mode labels exist in every locale and match localized guidance', () => {
  for (const locale of locales) {
    const localeSource = readFileSync(join(repoRoot, 'js', 'locales', `${locale}.json5`), 'utf8');
    for (const key of buttonModeKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    for (const key of configKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    for (const key of persistenceKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    for (const key of availabilityKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    for (const key of fieldLabelKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    for (const key of automationKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    for (const key of timerSummaryKeys) {
      assert.ok(localeValue(localeSource, key), `${locale} is missing ${key}`);
    }
    const guide = readFileSync(join(
      repoRoot,
      'docs',
      ...(locale === 'en' ? [] : ['i18n', locale]),
      'controller-mapping.md'
    ), 'utf8');
    for (const key of [...buttonModeKeys, ...automationKeys]) {
      assert.ok(guide.includes(localeValue(localeSource, key)),
        `${locale} controller-mapping guide must use its ${key} UI label`);
    }
  }
});

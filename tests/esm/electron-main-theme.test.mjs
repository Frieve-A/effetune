import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as themeRegistry from '../../js/theme-registry.mjs';

const source = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');

test('Electron resolves saved themes before creating themed windows and splash content', () => {
  assert.ok(source.includes("await import(pathToFileURL(path.join(__dirname, '../js/theme-registry.mjs')).href)"));
  assert.ok(source.includes("if ('theme' in cfg) cfg.theme = themeRegistry.normalizeThemeId(cfg.theme)"));
  assert.doesNotMatch(source.match(/const cfgDefaults = \{([\s\S]*?)\n  \};/)[1], /theme:/);
  assert.ok(source.includes('themeRegistry.getThemePreset(constants.getAppConfig()?.theme)'));
  assert.match(source, /new BrowserWindow\(\{\s*backgroundColor: preset\.windowBackground/);
  assert.ok(source.includes('background-color: color-mix(in srgb, ${preset.windowBackground} 90%, transparent)'));
  assert.ok(source.includes('color: ${preset.windowForeground}'));
  assert.doesNotMatch(source, /rgba\(34, 34, 34|#ccc|#999|setBackgroundColor\(/);
});


test('native chrome uses the selected theme scheme and the registry default', () => {
  const nativeTheme = {};
  const helper = source.match(/function applyNativeTheme\(config\) \{[\s\S]*?\n\}/)[0];
  const apply = runInNewContext(helper + '\napplyNativeTheme', { nativeTheme, themeRegistry });
  for (const [theme, expected] of [
    ['graphite', 'dark'], ['paper', 'light'], ['midnight', 'dark'],
    ['ember', 'dark'], ['mint', 'light'], ['unknown', 'dark'], [undefined, 'dark']
  ]) {
    apply({ theme });
    assert.equal(nativeTheme.themeSource, expected, theme);
  }
  const startup = source.slice(source.indexOf('async function initializeApp()'));
  assert.ok(startup.indexOf('constants.setAppConfig(cfg)') < startup.indexOf('applyNativeTheme(cfg)'));
  assert.ok(startup.indexOf('applyNativeTheme(cfg)') < startup.indexOf('createWindow()'));
  assert.ok(startup.includes('ipcHandlers.registerIpcHandlers({ onConfigSaved: applyNativeTheme })'));
});

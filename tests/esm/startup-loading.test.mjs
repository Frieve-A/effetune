import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the HTML entry and feature imports keep splash and optional features off the eager path', () => {
  const html = fs.readFileSync(new URL('../../effetune.html', import.meta.url), 'utf8');
  const startupHtml = fs.readFileSync(new URL('../../startup-audio.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
  const electronIntegration = fs.readFileSync(
    new URL('../../js/electron-integration.js', import.meta.url),
    'utf8'
  );
  const audioManager = fs.readFileSync(new URL('../../js/audio-manager.js', import.meta.url), 'utf8');
  const uiManager = fs.readFileSync(new URL('../../js/ui-manager.js', import.meta.url), 'utf8');

  assert.match(html, /<script type="module" src="js\/startup\.js"><\/script>/);
  assert.match(startupHtml, /<script type="module" src="js\/startup\.js"><\/script>/);
  assert.doesNotMatch(startupHtml, /effetune\.css|app\.js|jszip|jsmediatags|pipeline-analyzer/);
  assert.match(main, /loadFile\(constants\.getIsFirstLaunch\(\) \? 'startup-audio\.html' : 'effetune\.html'\)/);
  assert.match(main, /mainWindow\.loadFile\('effetune\.html'\)/);
  assert.doesNotMatch(main, /mainWindow\.reload\(\)/);
  assert.doesNotMatch(html, /<script[^>]+src="js\/app\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="js\/vendor\/(?:jszip|jsmediatags)/);
  assert.doesNotMatch(html, /<link[^>]+href="(?:effetune-library|pipeline-analyzer)\.css"/);
  assert.doesNotMatch(uiManager, /^import .*audio-player\.js/m);
  assert.doesNotMatch(uiManager, /^import .*library-manager-v2\.js/m);
  assert.doesNotMatch(uiManager, /^import .*pipeline-analyzer\/(?:controller|ui)\.js/m);
  assert.doesNotMatch(uiManager, /^import .*double-blind-test\.js/m);
  assert.match(uiManager, /import\('\.\/ui\/audio-player\.js'\)/);
  assert.match(uiManager, /import\('\.\/library\/library-manager-v2\.js'\)/);
  assert.match(uiManager, /import\('\.\/pipeline-analyzer\/controller\.js'\)/);
  assert.match(uiManager, /import\('\.\/ui\/double-blind-test\/double-blind-test\.js'\)/);
  assert.match(uiManager, /loadStylesheet\('effetune-library\.css'\)/);
  assert.match(uiManager, /loadStylesheet\('pipeline-analyzer\.css'\)/);
  assert.doesNotMatch(app, /^import .*midi-controller-manager\.js/m);
  assert.doesNotMatch(app, /import\('\.\/electron\/configIntegration\.js'\)/);
  assert.match(app, /import\('\.\/electron\/config-store\.js'\)/);
  assert.match(app, /if \(Array\.isArray\(midiMappings\) && midiMappings\.length > 0\)/);
  assert.match(app, /ensureMidiControllerManager\(\)/);
  assert.doesNotMatch(app, /getDefaultIrLibraryService/);
  assert.doesNotMatch(app, /createFirstLaunchPromise|temp-hide-style/);
  assert.doesNotMatch(
    /constructor\(\)[\s\S]*?^  }/m.exec(electronIntegration)?.[0] || '',
    /this\.(?:loadAudioPreferences|loadConfig)\(\)/
  );
  assert.match(electronIntegration, /import\('\.\/electron\/configIntegration\.js'\)/);
  assert.doesNotMatch(electronIntegration, /^import .*?(?:audioIntegration|presetIntegration|menuIntegration)/m);
  assert.match(electronIntegration, /import\('\.\/electron\/audioIntegration\.js'\)/);
  assert.match(electronIntegration, /import\('\.\/electron\/presetIntegration\.js'\)/);
  assert.doesNotMatch(audioManager, /^import .*offline-processor\.js/m);
  assert.match(audioManager, /import\('\.\/audio\/offline-processor\.js'\)/);
  assert.doesNotMatch(app, /AUDIOWORKLET_TO_PIPELINE_WAIT/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
function collectFiles(relativePath, extension) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(repoRoot, relativePath), { withFileTypes: true })) {
    const child = relativePath + '/' + entry.name;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) files.push(...collectFiles(child, extension));
    else if (extension.test(entry.name)) files.push(child);
  }
  return files;
}

const excludedFiles = new Set([
  // ThemePalette converts CSS colors to canvas strings and is tested directly.
  'plugins/theme-palette.js',
  // Data-only palettes selected by users for saved visualizer scenes, independent of the app theme.
  'js/visualizer/visualizer-palette-presets.js'
]);
const targets = [
  'css/effetune.css',
  'css/effetune-mobile.css',
  'css/effetune-library.css',
  'css/pipeline-analyzer.css',
  'css/onboarding-tour.css',
  'effetune.html',
  'features/measurement/measurement.html',
  'features/effetune_bench.html',
  '404.html',
  ...collectFiles('js', /\.js$/).filter(file => !file.startsWith('js/vendor/')),
  ...collectFiles('plugins', /\.(?:css|js)$/).filter(file => !file.startsWith('plugins/dsp/')),
  ...collectFiles('features/measurement', /\.css$/),
  ...collectFiles('features', /\.js$/),
  ...collectFiles('electron', /\.js$/).filter(file => file.split('/').length === 2)
].filter(file => !excludedFiles.has(file));

const literalPattern = /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g;
const namedCssColorPattern = /:\s*(?:white|black)(?![\w-])/g;
const commonRgbaPattern = /^rgba\((?:0,\s*0,\s*0|255,\s*255,\s*255),\s*[\d.]+\)$/;

function isAllowedCommonColor(line, literals, isJavaScript) {
  // A theme token remains authoritative; this literal only covers missing theme CSS.
  if (isJavaScript && literals.length === 1 &&
      /getPropertyValue\(['"]--et-[\w-]+['"]\)\??\.trim\(\)\s*\|\|\s*['"]#[0-9a-fA-F]{3,8}['"]/.test(line)) {
    return true;
  }
  if (/\b(?:box-shadow|text-shadow|filter)\s*:|\.style\.(?:boxShadow|textShadow|filter)\s*=/.test(line)) {
    return literals.every(literal => commonRgbaPattern.test(literal));
  }
  if (isJavaScript) return false;
  if (/\bbackground(?:-color)?\s*:/.test(line)) {
    const allBlack = literals.every(literal => /^rgba\(0,\s*0,\s*0,\s*[\d.]+\)$/.test(literal));
    if (allBlack) return true;
    const gloss = /linear-gradient\(180deg,\s*rgba\(255,\s*255,\s*255,\s*[\d.]+\),\s*rgba\(255,\s*255,\s*255,\s*0\)\s*\d+px\)/.test(line);
    return gloss && literals.every(literal => /^rgba\(255,\s*255,\s*255,\s*[\d.]+\)$/.test(literal));
  }
  return false;
}

test('theme color census has no unapproved literals in the themed application surfaces', () => {
  const findings = [];
  for (const relativePath of targets) {
    const isJavaScript = relativePath.endsWith('.js');
    const text = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const lines = text.split(/\r?\n/);
    const codeLines = text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\r\n]/g, ' ')).split(/\r?\n/);
    let inStyle = false;
    lines.forEach((originalLine, index) => {
      const line = codeLines[index];
      if (line.includes('<style')) inStyle = true;
      const isCssLike = relativePath.endsWith('.css') || (!isJavaScript && inStyle);
      if (line.includes('</style>')) inStyle = false;
      if (/^\s*\/\//.test(line) && !originalLine.includes('theme-allow:')) return;
      const literals = [
        ...line.matchAll(literalPattern),
        ...(isCssLike ? line.matchAll(namedCssColorPattern) : [])
      ].map(match => match[0]);
      if (originalLine.includes('theme-allow:')) {
        if (literals.length === 0) findings.push(`${relativePath}:${index + 1}: stale theme-allow marker`);
        return;
      }
      if (literals.length === 0) return;
      const declarations = line.split(';');
      if (declarations.every(declaration => {
        const colors = [...declaration.matchAll(literalPattern),
          ...(isCssLike ? declaration.matchAll(namedCssColorPattern) : [])].map(match => match[0]);
        // RGB serialization of palette channels does not define a fixed theme color.
        const fixedColors = colors.filter(color => !/^rgba?\(\$\{/.test(color));
        return fixedColors.length === 0 || isAllowedCommonColor(declaration, fixedColors, isJavaScript);
      })) return;
      findings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(findings, []);
});

test('theme token fallbacks do not authorize unrelated fixed colors', () => {
  const themed = "ctx.fillStyle = style.getPropertyValue('--et-danger').trim() || '#b91c1c'";
  assert.equal(isAllowedCommonColor(themed, ['#b91c1c'], true), true);
  assert.equal(isAllowedCommonColor("ctx.fillStyle = '#b91c1c'", ['#b91c1c'], true), false);
  assert.equal(isAllowedCommonColor(themed.replace('--et-danger', '--other-color'), ['#b91c1c'], true), false);
  assert.equal(isAllowedCommonColor(themed + ", other = '#fff'", ['#b91c1c', '#fff'], true), false);
});

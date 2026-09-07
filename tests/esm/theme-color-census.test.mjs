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

// ThemePalette converts CSS colors to canvas strings and is tested directly.
const excludedFiles = new Set(['plugins/theme-palette.js']);
const targets = [
  'effetune.css',
  'effetune-mobile.css',
  'effetune-library.css',
  'pipeline-analyzer.css',
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
        return colors.length === 0 || isAllowedCommonColor(declaration, colors, isJavaScript);
      })) return;
      findings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(findings, []);
});

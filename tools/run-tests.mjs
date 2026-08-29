import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function collectFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(toRepoPath(entryPath));
    }
  }
  return files.sort();
}

function collectTestFiles(directory, extension) {
  return collectFiles(directory, extension);
}

function collectCoverageIncludeArgs(directory, { exclude = [] } = {}) {
  const excludedFiles = new Set(exclude.map(normalizeRepoPath));
  return collectFiles(directory, '.js')
    .filter(file => !excludedFiles.has(file))
    .map(file => `--test-coverage-include=${file}`);
}

function runNodeTestPhase(name, args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });

  if (result.status !== 0) {
    console.error(`${name} failed.`);
    process.exit(result.status ?? 1);
  }
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function checkTestTitles(testFiles) {
  const titlePattern = /\btest\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  const bannedTerms = [
    /\bcover(?:s|ed|age|ing)?\b/i,
    /\bbranch(?:es)?\b/i,
    /\bremaining\b/i,
    /\buncovered\b/i
  ];
  const violations = [];

  for (const testFile of testFiles) {
    const absolutePath = path.join(repoRoot, testFile);
    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const match of source.matchAll(titlePattern)) {
      const title = match[2];
      if (bannedTerms.some(term => term.test(title))) {
        violations.push({
          file: testFile,
          line: lineNumberAt(source, match.index),
          title
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error('Test title quality check failed. Name tests after observable behavior, not coverage targets:');
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} "${violation.title}"`);
    }
    process.exit(1);
  }
}

function checkTestSourceHygiene(testFiles) {
  const bannedPatterns = [
    {
      pattern: /\bconsole\.(?:error|warn|log)\s*=/g,
      reason: 'inject console behavior through the test harness instead of mutating the global console'
    },
    {
      pattern: /\b(?:test|describe|it)\.(?:only|skip)\b/g,
      reason: 'do not commit focused or skipped tests'
    },
    {
      pattern: /node:coverage ignore/g,
      reason: 'do not hide test code from coverage'
    }
  ];
  const violations = [];

  for (const testFile of testFiles) {
    const absolutePath = path.join(repoRoot, testFile);
    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const { pattern, reason } of bannedPatterns) {
      for (const match of source.matchAll(pattern)) {
        violations.push({
          file: testFile,
          line: lineNumberAt(source, match.index),
          match: match[0],
          reason
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error('Test source hygiene check failed:');
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} "${violation.match}" - ${violation.reason}`);
    }
    process.exit(1);
  }
}

const cjsTests = collectTestFiles(path.join(repoRoot, 'tests/cjs'), '.test.cjs');
const allEsmTests = collectTestFiles(path.join(repoRoot, 'tests/esm'), '.test.mjs');
const playwrightImportPattern = /(?:from\s+['"]playwright['"]|import\(\s*['"]playwright['"]\s*\))/;
const browserTests = allEsmTests.filter(file => {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  return playwrightImportPattern.test(source);
});
const browserTestSet = new Set(browserTests);
const performanceTests = [
  'tests/esm/measurement-dsp-performance.test.mjs',
  'tests/esm/room-eq-performance.test.mjs',
  'tests/esm/spectrum-overlay-analyze.test.mjs',
  'tests/esm/spectrum-overlay-worklet.test.mjs'
];
const performanceTestSet = new Set(performanceTests);
// This DOM stress test runs in its own process because the shared Node test process
// can exhaust memory. The file requires an explicit isolated-run opt-in.
const isolatedTests = ['tests/esm/pipeline-analyzer-ui.test.mjs'];
const isolatedTestSet = new Set(isolatedTests);
// Preset calibration re-renders every shipped Tube Simulator preset after a long
// settling interval. Keep that release-time audit available through
// `npm run test:tube-calibration`, but do not put it on the default test/verify path.
const presetCalibrationTests = [
  'tests/esm/dsp-tube-simulator-listening-presets-v1.test.mjs'
];
const presetCalibrationTestSet = new Set(presetCalibrationTests);
const automationContractTests = [
  'tools/dsp-parity/automation-mixed.test.mjs',
  'dsp/plugins/reverb/ir_reverb/automation_test.mjs'
];
const esmTests = allEsmTests
  .filter(file =>
    !browserTestSet.has(file) &&
    !performanceTestSet.has(file) &&
    !isolatedTestSet.has(file) &&
    !presetCalibrationTestSet.has(file));
const cjsCoverageIncludes = collectCoverageIncludeArgs(path.join(repoRoot, 'electron'), {
  exclude: ['electron/main.js']
});
const esmCoverageIncludes = collectCoverageIncludeArgs(path.join(repoRoot, 'js'), {
  // The Worker entry/runtime and its OPFS SQLite repository/OO1 bridge execute
  // only in a browser Worker; their contracts belong to browser verification.
  exclude: [
    'js/library/repository/sqlite-oo1-adapter.js',
    'js/library/repository/web-catalog-repository.js',
    'js/library/repository/web-catalog-worker.js',
    'js/library/repository/web-sqlite-runtime.js'
  ]
});
const coverageThresholdArgs = [
  '--test-coverage-lines=90',
  '--test-coverage-functions=90',
  '--test-coverage-branches=80'
];

if (cjsTests.length === 0 && esmTests.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const allTests = [
  ...cjsTests,
  ...esmTests,
  ...browserTests,
  ...presetCalibrationTests,
  ...automationContractTests,
  ...performanceTests
];
checkTestTitles(allTests);
checkTestSourceHygiene(allTests);

const misclassifiedBrowserTests = browserTests.filter(file => !file.endsWith('-browser.test.mjs'));
if (misclassifiedBrowserTests.length > 0) {
  console.error('Playwright tests must use the *-browser.test.mjs suffix:');
  for (const testFile of misclassifiedBrowserTests) console.error(`- ${testFile}`);
  process.exit(1);
}

if (process.argv.includes('--browser')) {
  if (browserTests.length === 0) {
    console.error('No browser test files found.');
    process.exit(1);
  }
  runNodeTestPhase('Browser tests', [
    '--test',
    '--test-concurrency=1',
    ...browserTests
  ]);
  process.exit(0);
}

if (cjsTests.length > 0) {
  runNodeTestPhase('CommonJS tests', [
    '--test',
    '--experimental-test-coverage',
    ...cjsCoverageIncludes,
    ...coverageThresholdArgs,
    ...cjsTests
  ]);
}

if (esmTests.length > 0) {
  runNodeTestPhase('ES module tests', [
    '--test',
    '--experimental-test-coverage',
    ...esmCoverageIncludes,
    ...coverageThresholdArgs,
    ...esmTests
  ]);
}

runNodeTestPhase('DSP automation contract tests', [
  '--test',
  ...automationContractTests
]);

runNodeTestPhase('Pipeline Analyzer UI tests', [
  '--test',
  ...isolatedTests
], {
  EFFETUNE_RUN_PIPELINE_ANALYZER_UI_TEST: '1'
});

runNodeTestPhase('Performance tests', [
  '--test',
  '--test-concurrency=1',
  ...performanceTests
]);

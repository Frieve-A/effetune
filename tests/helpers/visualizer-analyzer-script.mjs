import { readFileSync } from 'node:fs';

// Classic-script fixtures must register the adapter's display classes before it initializes.
export const analyzerDisplayDependencies = [
  ['visualizer-drums', 'DrumsDisplay'],
  ['visualizer-note-text', 'NoteTextDisplay']
].map(([file, name]) => {
  const source = readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
  return `{ ${source}\nwindow.${name} = ${name}; }`;
}).join('\n');

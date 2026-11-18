import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../plugins/graph-readout.js', import.meta.url), 'utf8');

export const drawHudReadings = runInNewContext(source + '\ndrawHudReadings', { window: {} });
export const hudTextContext = {
    measureText: text => ({ width: text.length * 6 }),
    save() {},
    restore() {},
    translate() {},
    scale() {}
};

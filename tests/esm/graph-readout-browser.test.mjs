import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const source = fs.readFileSync(new URL('../../plugins/graph-readout.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../plugins/graph-readout.css', import.meta.url), 'utf8');

// Runs fn in a page with a 400x200 SVG surface inside #mount and the readout script and CSS loaded.
async function inPage(fn, arg) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 300 } });
    await page.setContent('<div id="mount" style="position:relative;width:400px;height:200px;' +
      '--et-graph-label-strong:rgb(1, 2, 3)">' +
      '<svg id="surface" viewBox="0 0 400 200" style="display:block;width:400px;height:200px"></svg></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: source });
    await page.addScriptTag({
      content: 'window.nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));'
    });
    return await page.evaluate(fn, arg);
  } finally {
    await browser.close();
  }
}

test('live values keep the sign slot, decimal point and box edge fixed until the readout hides',
  { timeout: 60_000 }, async () => {
    const states = await inPage(async () => {
      const mount = document.getElementById('mount');
      let value = '';
      window.GraphReadout.attach({
        mount,
        surface: document.getElementById('surface'),
        read: () => ({ cursor: '1.00 kHz', rows: [{ label: 'Gain', color: 'red', value }] })
      });
      const measure = () => {
        const number = mount.querySelector('.graph-readout-box .graph-readout-value .graph-readout-number');
        const range = document.createRange();
        const dot = number.firstChild.data.indexOf('.');
        range.setStart(number.firstChild, dot);
        range.setEnd(number.firstChild, dot + 1);
        const box = mount.querySelector('.graph-readout-box').getBoundingClientRect();
        return {
          sign: mount.querySelector('.graph-readout-box .graph-readout-value .graph-readout-sign').textContent,
          text: number.textContent,
          decimal: range.getBoundingClientRect().left,
          numberRight: number.getBoundingClientRect().right,
          boxLeft: box.left,
          boxWidth: box.width
        };
      };
      const results = [];
      for (const next of ['3.20 dB', '−3.20 dB', '13.20 dB', '3.20 dB']) {
        value = next;
        mount.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 150 }));
        await window.nextFrame();
        results.push(measure());
      }
      mount.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      results.push([...mount.querySelectorAll('.graph-readout [style*="min-width"]')].length);
      return results;
    });
    const [positive, negative, wider, back, heldAfterLeave] = states;
    assert.deepEqual([positive.sign, positive.text, negative.sign, negative.text], ['', '3.20', '−', '3.20']);
    for (const key of ['decimal', 'numberRight', 'boxLeft', 'boxWidth']) {
      assert.equal(negative[key], positive[key], `${key} is unchanged when the sign appears`);
      assert.equal(back[key], wider[key], `${key} does not shrink back while shown`);
    }
    assert.equal(heldAfterLeave, 0, 'pointerleave releases the held widths');
  });

test('prefixed and compound values split into prefix, sign, last number and unit with a fixed number edge',
  { timeout: 60_000 }, async () => {
    const values = ['in −12.0 dB', '1.25 kHz · −135°', '120 V · 3.25 mA', '1 V · −3.25 mA', '—', '−∞ dB', 'A4 +39¢'];
    const states = await inPage(async values => {
      const mount = document.getElementById('mount');
      let value = '';
      window.GraphReadout.attach({
        mount,
        surface: document.getElementById('surface'),
        read: () => ({ cursor: '', rows: [{ label: 'Value', color: 'red', value }] })
      });
      const results = [];
      for (const next of values) {
        value = next;
        mount.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 150 }));
        await window.nextFrame();
        const node = mount.querySelector('.graph-readout-box .graph-readout-value');
        results.push({
          parts: [...node.children].map(part => part.textContent),
          numberRight: node.querySelector('.graph-readout-number').getBoundingClientRect().right
        });
      }
      return results;
    }, values);
    assert.deepEqual(states.map(state => state.parts), [
      ['in ', '−', '12.0', ' dB'],
      ['1.25 kHz · ', '−', '135', '°'],
      ['120 V · ', '', '3.25', ' mA'],
      ['1 V · ', '−', '3.25', ' mA'],
      ['', '', '—', ''],
      ['', '−', '∞', ' dB'],
      ['A4 ', '+', '39', '¢']
    ]);
    assert.equal(states[3].numberRight, states[2].numberRight,
      'the number edge stays put when the prefix shortens and a sign appears');
  });

test('row text keeps the label color while the swatch follows a changing series color in place',
  { timeout: 60_000 }, async () => {
    const [first, second] = await inPage(async () => {
      const mount = document.getElementById('mount');
      let color = 'rgb(255, 0, 0)';
      window.GraphReadout.attach({
        mount,
        surface: document.getElementById('surface'),
        read: () => ({ cursor: '', rows: [{ label: 'Gain', color, value: '1.0 dB' }] })
      });
      const results = [];
      for (const next of ['rgb(255, 0, 0)', 'rgb(0, 0, 255)']) {
        color = next;
        mount.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 150 }));
        await window.nextFrame();
        const row = mount.querySelector('.graph-readout-box .graph-readout-row');
        if (!window.firstRow) window.firstRow = row;
        results.push({
          sameRow: row === window.firstRow,
          label: getComputedStyle(row.querySelector('.graph-readout-label')).color,
          value: getComputedStyle(row.querySelector('.graph-readout-number')).color,
          swatch: getComputedStyle(row.querySelector('.graph-readout-swatch')).borderTopColor
        });
      }
      return results;
    });
    assert.deepEqual(first, { sameRow: true, label: 'rgb(1, 2, 3)', value: 'rgb(1, 2, 3)', swatch: 'rgb(255, 0, 0)' });
    assert.deepEqual(second, { sameRow: true, label: 'rgb(1, 2, 3)', value: 'rgb(1, 2, 3)', swatch: 'rgb(0, 0, 255)' });
  });

test('dots are drawn only for finite points inside the plot and crosshairs stay in the plot',
  { timeout: 60_000 }, async () => {
    const [inside, invalidAt] = await inPage(async () => {
      const mount = document.getElementById('mount');
      let at = { x: 200, y: 300 };
      window.GraphReadout.attach({
        mount,
        surface: document.getElementById('surface'),
        plot: () => ({ left: 0, top: 20, width: 400, height: 160 }),
        crosshair: 'xy',
        read: () => ({
          cursor: '',
          at,
          rows: [100, NaN, 5].map(y => ({ label: String(y), color: 'red', value: '1', y }))
        })
      });
      const results = [];
      for (const next of [{ x: 200, y: 300 }, { x: NaN, y: 100 }]) {
        at = next;
        mount.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 100 }));
        await window.nextFrame();
        results.push({
          dots: [...mount.querySelectorAll('.graph-readout-dot')].map(dot => dot.style.top),
          lineY: mount.querySelector('.graph-readout-line-y').style.top
        });
      }
      return results;
    });
    assert.deepEqual(inside, { dots: ['100px'], lineY: '180px' });
    assert.deepEqual(invalidAt.dots, []);
  });

test('a result crosshair overrides the attach option for that point',
  { timeout: 60_000 }, async () => {
    const states = await inPage(async () => {
      const mount = document.getElementById('mount');
      let crosshair;
      window.GraphReadout.attach({
        mount,
        surface: document.getElementById('surface'),
        crosshair: 'xy',
        read: () => ({ cursor: 'A4', rows: [], crosshair })
      });
      const results = [];
      for (const next of [undefined, 'none']) {
        crosshair = next;
        mount.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 100 }));
        await window.nextFrame();
        results.push(['x', 'y'].map(axis => mount.querySelector(`.graph-readout-line-${axis}`).style.display));
      }
      return results;
    });
    assert.deepEqual(states, [['', ''], ['none', 'none']]);
  });

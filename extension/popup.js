import { ExtensionClient } from './protocol.js';

export const POPUP_STATUS = Object.freeze({
  stopped: 'Not processing',
  starting: 'Starting…',
  processing: 'Processing',
  stopping: 'Stopping…',
  error: 'Needs attention'
});

function friendlyError(action) {
  if (action === 'start') {
    return 'EffeTune could not capture this tab. Make sure the tab is playing audio, then try again.';
  }
  if (action === 'preset') {
    return 'That preset could not be applied. Your current pipeline was kept.';
  }
  return 'Something went wrong. Try again.';
}

function setOptions(select, presets) {
  const previous = select.value;
  const names = Object.keys(presets || {}).sort((left, right) => left.localeCompare(right));
  select.replaceChildren();
  if (names.length === 0) {
    select.add(new Option('No saved presets', ''));
  } else {
    for (const name of names) select.add(new Option(name, name));
    if (names.includes(previous)) select.value = previous;
  }
  return names.length;
}

export function renderPopup(elements, snapshot) {
  const busy = snapshot.status === 'starting' || snapshot.status === 'stopping';
  const processing = snapshot.status === 'processing';
  elements.status.textContent = POPUP_STATUS[snapshot.status] || POPUP_STATUS.error;
  elements.indicator.className = `status-indicator ${processing ? 'processing' : busy ? 'pending' : snapshot.status === 'error' ? 'error' : ''}`.trim();
  elements.target.textContent = snapshot.target?.title || 'No tab selected';
  elements.target.title = snapshot.target?.title || '';
  elements.startStop.textContent = processing || snapshot.status === 'stopping'
    ? 'Stop processing'
    : 'Start processing';
  elements.startStop.disabled = busy;
  elements.bypass.checked = snapshot.masterBypass === true;
  elements.bypass.disabled = !processing;
  const presetCount = setOptions(elements.preset, snapshot.presets);
  elements.preset.disabled = presetCount === 0 || busy;
  elements.applyPreset.disabled = presetCount === 0 || busy;
  elements.edit.disabled = false;
  if (snapshot.status === 'error') {
    elements.message.textContent = 'Processing stopped. Choose a tab that is playing audio and try again.';
    elements.message.hidden = false;
    if (snapshot.error) console.error('[EffeTune extension]', snapshot.error);
  } else {
    elements.message.hidden = true;
  }
}

export async function createPopupController({ client = new ExtensionClient(), chromeApi = chrome, documentRef = document } = {}) {
  const elements = {
    status: documentRef.getElementById('sessionStatus'),
    indicator: documentRef.getElementById('statusIndicator'),
    target: documentRef.getElementById('targetTitle'),
    startStop: documentRef.getElementById('startStopButton'),
    bypass: documentRef.getElementById('bypassToggle'),
    preset: documentRef.getElementById('presetSelect'),
    applyPreset: documentRef.getElementById('applyPresetButton'),
    edit: documentRef.getElementById('editPipelineButton'),
    message: documentRef.getElementById('popupMessage')
  };
  let snapshot = await client.connect();
  renderPopup(elements, snapshot);

  const run = async (action, callback) => {
    elements.message.hidden = true;
    try {
      const result = await callback();
      if (result?.status) {
        snapshot = result;
        renderPopup(elements, snapshot);
      }
    } catch (error) {
      console.error(`[EffeTune extension] ${action} failed`, error);
      elements.message.textContent = friendlyError(action);
      elements.message.hidden = false;
    }
  };

  client.addEventListener('state', event => {
    snapshot = event.detail;
    renderPopup(elements, snapshot);
  });

  elements.startStop.addEventListener('click', () => run(snapshot.status === 'processing' ? 'stop' : 'start', async () => {
    if (snapshot.status === 'processing') return client.request('stop');
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error('Active tab unavailable');
    return client.request('start', { tabId: tab.id, title: tab.title || 'Current tab' });
  }));
  elements.bypass.addEventListener('change', () => run('bypass', () =>
    client.request('setBypass', { enabled: elements.bypass.checked })));
  elements.applyPreset.addEventListener('click', () => {
    if (elements.preset.value) run('preset', () => client.request('applyPreset', { name: elements.preset.value }));
  });
  elements.edit.addEventListener('click', () => run('editor', () => client.request('openEditor')));

  return { client, getSnapshot: () => snapshot };
}

if (typeof chrome !== 'undefined' && typeof document !== 'undefined') {
  createPopupController().catch(error => {
    console.error('[EffeTune extension] Popup initialization failed', error);
    const message = document.getElementById('popupMessage');
    if (message) {
      message.textContent = 'EffeTune could not connect. Close this window and try again.';
      message.hidden = false;
    }
  });
}

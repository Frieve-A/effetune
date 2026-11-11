const PREFIX = 'dialog.config.networkOutput.';
const STATES = ['searching', 'connecting', 'playing', 'unreachable'];
const NOTES = ['offline', 'format', 'taken', 'startFailed'];

export function updateNetworkOutputTargetText(row, target, selected, t) {
  row.type.textContent = target.type === 'cast' ? 'Chromecast' : 'UPnP AV';
  row.name.textContent = target.name;
  const state = STATES.includes(target.state) ? target.state : 'searching';
  row.state.textContent = selected ? t(PREFIX + 'status.' + state) : '';
  row.state.setAttribute('data-state', selected && state === 'playing' ? 'published'
    : selected && state === 'unreachable' ? 'error' : 'pending');
  row.note.textContent = selected && NOTES.includes(target.note) ? t(PREFIX + 'note.' + target.note) : '';
}

export function initNetworkOutputPicker(uiManager) {
  const bridge = window.electronAPI?.networkOutputV1;
  if (!bridge?.setPickerOpen) return;
  const button = document.getElementById('networkOutputButton');
  const picker = document.getElementById('networkOutputPicker');
  if (!button || !picker) return;

  const title = document.getElementById('networkOutputPickerTitle');
  const description = document.createElement('p');
  title.parentElement.insertAdjacentElement('afterend', description);
  const close = picker.querySelector('.preset-dialog-close');
  const local = document.getElementById('networkOutputPickerLocal');
  const targets = document.getElementById('networkOutputPickerTargets');
  const message = document.getElementById('networkOutputPickerMessage');
  const t = key => uiManager.t(key);
  const rows = new Map();
  let status = null;
  let busy = false;
  let failure = '';
  let visibilityRevision = 0;

  function createRow(id) {
    const row = document.createElement('div');
    row.className = 'network-output-row';
    row.innerHTML = `<label class="network-output-enable">
      <input type="checkbox"><span class="network-output-type"></span><span class="network-output-name"></span>
      </label><span class="network-output-state"></span><div class="network-output-note"></div>`;
    const checkbox = row.querySelector('input');
    checkbox.addEventListener('change', () => change(() => bridge.setTargetEnabled(id, checkbox.checked)));
    return {
      row, checkbox, type: row.querySelector('.network-output-type'), name: row.querySelector('.network-output-name'),
      state: row.querySelector('.network-output-state'), note: row.querySelector('.network-output-note')
    };
  }

  function render() {
    const devices = status?.targets ?? [];
    button.classList.toggle('active', !!status?.enabled && devices.some(device => device.enabled && device.state === 'playing'));
    if (!picker.matches(':popover-open')) return;
    const ids = new Set(devices.map(device => device.id));
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      row.row.remove();
      rows.delete(id);
    }
    for (const [index, device] of devices.entries()) {
      let row = rows.get(device.id);
      if (!row) {
        row = createRow(device.id);
        rows.set(device.id, row);
      }
      const atIndex = targets.children[index] ?? null;
      if (atIndex !== row.row) targets.insertBefore(row.row, atIndex);
      const selected = status.enabled && device.enabled;
      row.checkbox.checked = selected;
      row.checkbox.setAttribute('aria-disabled', String(busy));
      updateNetworkOutputTargetText(row, device, selected, t);
    }
    local.checked = status?.localEnabled !== false;
    local.disabled = !status;
    local.setAttribute('aria-disabled', String(!status || busy));
    message.textContent = failure ? t(PREFIX + failure)
      : !status ? t(PREFIX + 'loading') : devices.length === 0 ? t(PREFIX + 'empty') : '';
  }

  function acceptStatus(next) {
    status = next;
    render();
  }

  async function change(request) {
    if (!status || busy) {
      render();
      return;
    }
    busy = true;
    failure = '';
    try {
      // Read the checkbox before rendering the last confirmed state.
      const pending = request();
      render();
      status = await pending;
    } catch (error) {
      console.warn('Failed to change Network Output selection:', error);
      failure = 'pickerSaveFailed';
    } finally {
      busy = false;
      render();
    }
  }

  local.addEventListener('change', () => change(() => bridge.setConfiguration({ localEnabled: local.checked })));
  picker.addEventListener('toggle', async event => {
    const open = event.newState === 'open';
    const revision = ++visibilityRevision;
    if (open) {
      failure = '';
      render();
    }
    try {
      const next = await bridge.setPickerOpen(open);
      if (open && revision === visibilityRevision) acceptStatus(next);
    } catch (error) {
      console.warn('Failed to change Network Output picker visibility:', error);
      if (open && revision === visibilityRevision) {
        failure = 'pickerLoadFailed';
        render();
      }
    }
  });
  bridge.onStatus(acceptStatus);
  void bridge.getStatus().then(next => {
    if (status === null) acceptStatus(next);
  }).catch(error => console.warn('Failed to read Network Output status:', error));

  button.hidden = false;
  return {
    updateTexts() {
      button.title = t(PREFIX + 'title');
      title.textContent = t(PREFIX + 'pickerTitle');
      description.textContent = t(PREFIX + 'pickerDescription');
      button.setAttribute('aria-label', button.title);
      close.title = t('ui.title.close');
      close.setAttribute('aria-label', close.title);
      local.nextElementSibling.textContent = t(PREFIX + 'local');
      if (picker.matches(':popover-open')) render();
    }
  };
}

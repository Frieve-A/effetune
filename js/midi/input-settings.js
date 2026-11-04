export function bindMidiInputSettings({ manager, select, refreshButton, status, selectedKey = '', t }) {
  let disposed = false;
  let choice = selectedKey;
  const change = () => { choice = select.value; };
  const render = () => {
    if (disposed) return;
    const current = choice;
    const inputs = manager?.listInputs().filter(input => input.connected) || [];
    const entries = [{ key: '', name: t('dialog.audioConfig.midiInput.none') }, ...inputs];
    if (current && !inputs.some(input => input.key === current)) {
      entries.push({ key: current, name: t('dialog.audioConfig.midiInput.disconnected', {
        name: manager?.getDeviceDisplayName(current) || current.split('\0')[0]
      }) });
    }
    select.innerHTML = '';
    for (const entry of entries) {
      const option = select.ownerDocument.createElement('option');
      option.value = entry.key;
      option.textContent = entry.name;
      select.appendChild(option);
    }
    select.value = current;
    const supported = manager?.isSupported() === true;
    refreshButton.disabled = !supported;
    status.textContent = t(!supported ? 'dialog.audioConfig.midiInput.unsupported'
      : manager.midiAccessError ? 'dialog.audioConfig.midiInput.unavailable'
      : 'dialog.audioConfig.midiInput.help');
  };
  const refresh = async () => {
    refreshButton.disabled = true;
    try {
      await manager.ensureMidiAccess();
      await manager.syncRuntime();
    } finally { render(); }
  };
  const unsubscribe = manager?.onChange(render);
  select.addEventListener('change', change);
  refreshButton.addEventListener('click', refresh);
  render();
  void manager?.setDialogOpen(true);
  return () => {
    disposed = true;
    unsubscribe?.();
    select.removeEventListener('change', change);
    refreshButton.removeEventListener('click', refresh);
    void manager?.setDialogOpen(false);
  };
}

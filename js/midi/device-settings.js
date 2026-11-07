// Binds the Audio Configuration MIDI input and output selects, which share one
// Refresh button and one status area.
export function bindMidiDeviceSettings({ manager, inputSelect, outputSelect, refreshButton, status, selectedInputKey = '', selectedOutputKey = '', t }) {
  let disposed = false;
  const devices = [
    { select: inputSelect, choice: selectedInputKey, list: () => manager.listInputs() },
    { select: outputSelect, choice: selectedOutputKey, list: () => manager.listOutputs() }
  ];
  for (const device of devices) device.change = () => { device.choice = device.select.value; };
  const render = () => {
    if (disposed) return;
    for (const { select, choice, list } of devices) {
      const ports = manager ? list().filter(port => port.connected) : [];
      const entries = [{ key: '', name: t('dialog.audioConfig.midiDevices.none') }, ...ports];
      if (choice && !ports.some(port => port.key === choice)) {
        entries.push({ key: choice, name: t('dialog.audioConfig.midiDevices.disconnected', {
          name: manager?.getDeviceDisplayName(choice) || choice.split('\0')[0]
        }) });
      }
      select.innerHTML = '';
      for (const entry of entries) {
        const option = select.ownerDocument.createElement('option');
        option.value = entry.key;
        option.textContent = entry.name;
        select.appendChild(option);
      }
      select.value = choice;
    }
    const supported = manager?.isSupported() === true;
    refreshButton.disabled = !supported;
    status.textContent = !supported ? t('dialog.audioConfig.midiDevices.unsupported')
      : manager.midiAccessError ? t('dialog.audioConfig.midiDevices.unavailable')
      : `${t('dialog.audioConfig.midiInput.help')}\n${t('dialog.audioConfig.midiOutput.help')}`;
  };
  const refresh = async () => {
    refreshButton.disabled = true;
    try {
      await manager.ensureMidiAccess();
      await manager.syncRuntime();
    } finally { render(); }
  };
  const unsubscribe = manager?.onChange(render);
  for (const { select, change } of devices) select.addEventListener('change', change);
  refreshButton.addEventListener('click', refresh);
  render();
  void manager?.setDialogOpen(true);
  return () => {
    disposed = true;
    unsubscribe?.();
    for (const { select, change } of devices) select.removeEventListener('change', change);
    refreshButton.removeEventListener('click', refresh);
    void manager?.setDialogOpen(false);
  };
}

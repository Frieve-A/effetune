export function nativeDriverFor(platform) {
  return platform === 'win32' ? 'wasapi' : 'miniaudio';
}

export function driverName(platform, backend) {
  if (platform === 'win32') return 'WASAPI';
  if (platform === 'darwin') return 'Core Audio';
  switch (backend?.toLowerCase()) {
    case 'alsa': return 'ALSA';
    case 'pulseaudio': return 'PulseAudio';
    default: return 'PulseAudio / ALSA';
  }
}

export async function listDriverDevices(driver, defaultLabel) {
  const result = await window.electronAPI.audioEngine.list(driver);
  const devices = [];
  for (const [key, kind] of [['inputs','audioinput'], ['outputs','audiooutput']]) {
    const entries = (result[key] || []).map(item => ({
      kind, deviceId: item.id, groupId: item.id, label: item.name, channels: item.channels
    }));
    const selected = (result[key] || []).find(item => item.isDefault);
    devices.push({kind, deviceId:'default', groupId:selected?.id || '', label:defaultLabel}, ...entries);
  }
  return {devices, backend:result.backend, ok:result.ok};
}

export function readDriverMemory(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return Object.fromEntries(['standard','wasapi','miniaudio'].filter(key =>
      parsed?.[key] && typeof parsed[key] === 'object').map(key => [key,parsed[key]]));
  } catch { return {}; }
}

export function selectDriverDevices(inputs, outputs, previous, remembered) {
  const select = (devices, key) => {
    const id = remembered?.[`${key}DeviceId`];
    if (devices.some(item => item.deviceId === id)) return id;
    const label = (remembered || previous)?.[`${key}DeviceLabel`];
    return devices.find(item => label && item.label === label)?.deviceId || 'default';
  };
  return { input:select(inputs,'input'), output:select(outputs,'output') };
}

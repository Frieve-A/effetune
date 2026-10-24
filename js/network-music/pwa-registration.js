import { parsePwaPairingLink } from './pwa-connection.js';

const MESSAGES = {
  invalidPairingLink: 'Paste the Remote Control link from EffeTune on your local network.',
  connectionFailed: 'Could not connect. Check the device, allow local network access, and use a supported browser or a trusted HTTPS connection.',
  registrationExpired: 'The connection code has changed. Paste a new Remote Control link from this device.',
  differentDevice: 'This link belongs to a different device. Add it as a new device instead.',
  pwaUnsupported: 'This device does not support PWA music playback. You can open its remote editor.',
  deviceLimit: 'Remove a saved device before adding another.',
  cameraUnavailable: 'Camera scanning is unavailable. Copy the Remote Control link and paste it here.',
  cameraDenied: 'Could not use the camera. Allow camera access or paste the link instead.',
  sessionOnly: 'Connected for this session. Browser storage is unavailable; add the device again after reopening the app.',
  connected: 'Device added. Select it as your playback device or library.',
  updated: 'Connection updated.',
  removed: 'Device removed.',
  storageRemoveFailed: 'Device removed for this session. Browser storage could not be updated.'
};

export class PwaDeviceRegistration {
  constructor({ api, uiManager, documentRef = globalThis.document, windowRef = globalThis.window }) {
    Object.assign(this, { api, uiManager, document: documentRef, window: windowRef });
    this.generation = 0;
    this.api.manageConnection = id => this.open(id);
    this.onPageHide = () => this.close();
    this.window.addEventListener('pagehide', this.onPageHide);
  }

  hint(key, fallback) {
    const value = this.uiManager.t(`networkMusic.pwa.${key}`);
    return value === `networkMusic.pwa.${key}` ? fallback : value;
  }

  element(tag, text, className) {
    const element = this.document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  button(text, key, action) {
    const button = this.element('button', text, 'header-button');
    button.type = 'button';
    button.title = this.hint(key, text);
    button.addEventListener('click', action);
    return button;
  }

  open(id = null) {
    this.close();
    const selected = this.api.registrations.find(record => record.id === id);
    this.hostId = selected?.hostId ?? null;
    const generation = ++this.generation;
    const dialog = this.element('dialog', '', 'pwa-device-dialog');
    this.dialog = dialog;
    const heading = this.element('h2', selected ? `Update connection · ${selected.name}` : 'Add device');
    heading.id = 'pwa-device-title';
    dialog.setAttribute('aria-labelledby', heading.id);
    const help = this.element('p', 'On the desktop, open Settings > Remote Control, enable Allow remote control, and copy its link or scan its QR code here.');
    help.title = this.hint('setup', help.textContent);
    const form = this.element('form');
    const label = this.element('label', 'Pairing link');
    const input = this.element('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.maxLength = 1024;
    input.required = true;
    input.setAttribute('aria-label', 'Pairing link');
    input.title = this.hint('pairingLink', 'Paste the link shown in Remote Control on the desktop.');
    label.append(input);
    const actions = this.element('div', '', 'pwa-device-actions');
    const connect = this.button(selected ? 'Update connection' : 'Connect', 'connect', () => {});
    connect.type = 'submit';
    const scan = this.button('Scan QR code', 'scan', () => { void this.startCamera(); });
    scan.hidden = true;
    actions.append(connect, scan, this.button('Close', 'close', () => this.close()));
    this.video = this.element('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.hidden = true;
    this.stopScanButton = this.button('Stop camera', 'stopCamera', () => this.stopCamera());
    this.stopScanButton.hidden = true;
    this.status = this.element('p', '', 'pwa-device-status');
    this.status.setAttribute('role', 'status');
    const legacy = this.button('Open remote editor', 'openEditor', () => {
      try {
        const target = parsePwaPairingLink(input.value);
        this.window.open(`${target.origin}/?t=${encodeURIComponent(target.token)}`, '_blank', 'noopener,noreferrer');
      } catch { this.showStatus('invalidPairingLink'); }
    });
    legacy.hidden = true;
    form.append(label, actions, this.video, this.stopScanButton, this.status, legacy);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (connect.disabled) return;
      this.stopCamera();
      connect.disabled = true;
      legacy.hidden = true;
      this.status.textContent = 'Connecting…';
      try {
        const result = await this.api.register(input.value, this.hostId);
        if (generation !== this.generation) return;
        input.value = '';
        this.showStatus(!result.persistent ? 'sessionOnly' : this.hostId ? 'updated' : 'connected');
        this.renderSavedDevices();
      } catch (error) {
        if (generation !== this.generation) return;
        this.showStatus(MESSAGES[error.code] ? error.code : 'connectionFailed');
        legacy.hidden = error.code !== 'pwaUnsupported';
      } finally { if (generation === this.generation) connect.disabled = false; }
    });
    this.input = input;
    this.savedDevices = this.element('div', '', 'pwa-device-list');
    dialog.append(heading, help, form, this.savedDevices);
    this.renderSavedDevices();
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => { if (this.dialog === dialog) this.close(); });
    this.document.body.append(dialog);
    dialog.showModal();
    input.focus();
    const detector = this.window.BarcodeDetector;
    if (detector && this.window.navigator?.mediaDevices?.getUserMedia) {
      void detector.getSupportedFormats().then(formats => {
        if (generation === this.generation) scan.hidden = !formats.includes('qr_code');
      }).catch(() => {});
    }
    return true;
  }

  renderSavedDevices() {
    this.savedDevices.replaceChildren();
    if (!this.api.registrations.length) return;
    this.savedDevices.append(this.element('h3', 'Saved devices'));
    for (const record of this.api.registrations) {
      const row = this.element('div', '', 'pwa-device-row');
      const name = this.element('span', record.name);
      row.append(name, this.button('Update connection', 'update', () => this.open(record.id)),
        this.button('Remove', 'remove', () => {
          const result = this.api.remove(record.hostId);
          this.showStatus(result.persistent ? 'removed' : 'storageRemoveFailed');
          this.renderSavedDevices();
        }));
      this.savedDevices.append(row);
    }
  }

  showStatus(key) {
    this.status.textContent = MESSAGES[key];
    this.status.title = this.hint(key, MESSAGES[key]);
  }

  async startCamera() {
    this.stopCamera();
    const generation = ++this.cameraGeneration;
    try {
      const stream = await this.window.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (!this.dialog || generation !== this.cameraGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.hidden = false;
      this.stopScanButton.hidden = false;
      await this.video.play();
      const detector = new this.window.BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!this.stream || generation !== this.cameraGeneration) return;
        try {
          const codes = await detector.detect(this.video);
          if (!this.stream || generation !== this.cameraGeneration) return;
          if (codes.length) {
            parsePwaPairingLink(codes[0].rawValue);
            this.input.value = codes[0].rawValue;
            this.stopCamera();
            this.input.form.requestSubmit();
            return;
          }
        } catch (error) {
          this.showStatus(error.code === 'invalidPairingLink' ? 'invalidPairingLink' : 'cameraUnavailable');
          this.stopCamera();
          return;
        }
        this.scanTimer = setTimeout(scan, 250);
      };
      await scan();
    } catch {
      if (generation === this.cameraGeneration && this.dialog) { this.stopCamera(); this.showStatus('cameraDenied'); }
    }
  }

  stopCamera() {
    this.cameraGeneration = (this.cameraGeneration ?? 0) + 1;
    clearTimeout(this.scanTimer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.video) { this.video.srcObject = null; this.video.hidden = true; }
    if (this.stopScanButton) this.stopScanButton.hidden = true;
  }

  close() {
    this.generation += 1;
    this.stopCamera();
    const dialog = this.dialog;
    this.dialog = null;
    dialog?.close();
    dialog?.remove();
  }

  dispose() {
    this.close();
    this.window.removeEventListener('pagehide', this.onPageHide);
    this.api.manageConnection = null;
  }
}

// Network configuration uses the same host boundary as browsing and playback.
export class NetworkMusicSettings {
  constructor({ root, api, remoteSettings, translate, documentRef = globalThis.document }) {
    Object.assign(this, { root, api, remoteSettings, translate, document: documentRef });
    this.labels = [];
    this.closed = false;
  }

  element(tag, key, parent = this.root, className = '') {
    const element = this.document.createElement(tag);
    if (className) element.className = className;
    if (key) { this.labels.push([element, key]); element.textContent = this.translate(key); }
    parent.appendChild(element);
    return element;
  }

  section(key) {
    const section = this.element('div');
    section.className = 'device-section network-settings-section';
    this.element('h3', `networkMusic.settings.${key}`, section, 'section-label');
    return section;
  }

  input(parent, key, type = 'text') {
    const label = this.element('label', null, parent, 'network-setting-row');
    if (type !== 'checkbox') this.element('span', `networkMusic.settings.${key}`, label);
    const input = this.element('input', null, label);
    input.type = type;
    input.autocomplete = 'off';
    if (type === 'checkbox') {
      label.className = 'checkbox-container';
      this.element('span', `networkMusic.settings.${key}`, label);
    } else input.className = 'browser-setting-input';
    input.setAttribute('aria-label', this.translate(`networkMusic.settings.${key}`));
    return input;
  }

  button(parent, key, action) {
    const button = this.element('button', key, parent);
    button.type = 'button';
    button.className = 'library-button';
    button.addEventListener('click', () => this.run(action));
    return button;
  }

  async run(action) {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      await action();
      if (!this.closed) this.status.textContent = this.translate('networkMusic.settings.saved');
    } catch (error) {
      console.error('Network settings operation failed:', error);
      if (!this.closed) this.status.textContent = this.translate(`networkMusic.settings.${
        ['subsonicConnection', 'subsonicAuthentication', 'gatewayRequired'].includes(error.code) ? error.code : 'failed'}`);
    } finally { this.busy = false; }
  }

  mount() {
    if (this.api.networkMusicConfigure) {
      if (!this.api.isPwa) {
        const gateway = this.section('gateway');
        this.element('p', 'networkMusic.settings.gatewayHelp', gateway);
        this.allowLibraries = this.input(gateway, 'allowLibraries', 'checkbox');
        this.allowPlayers = this.input(gateway, 'allowPlayers', 'checkbox');
        this.button(gateway, 'networkMusic.save', async () => {
          await this.api.networkMusicConfigure({ gatewayPermissions: { libraries: this.allowLibraries.checked, players: this.allowPlayers.checked } });
          await this.refresh();
        });
      }

      const sources = this.section('subsonic');
      this.element('p', this.api.isPwa ? 'networkMusic.settings.directHelp' : 'networkMusic.settings.subsonicHelp', sources);
      this.sourceName = this.input(sources, 'name');
      this.sourceUrl = this.input(sources, 'serverUrl', 'url');
      this.sourceUser = this.input(sources, 'user');
      this.sourcePassword = this.input(sources, 'password', 'password');
      this.button(sources, 'networkMusic.settings.add', async () => {
        await this.api.networkMusicConfigure({ subsonic: { action: 'add', name: this.sourceName.value,
          url: this.sourceUrl.value, user: this.sourceUser.value, password: this.sourcePassword.value } });
        this.sourcePassword.value = '';
        await this.refresh();
      });
      this.sourceList = this.element('div', null, sources, 'network-settings-list');

      if (!this.api.isPwa) {
        const manual = this.section('manual');
        this.element('p', 'networkMusic.settings.manualHelp', manual);
        this.manualUrl = this.input(manual, 'descriptorUrl', 'url');
        this.button(manual, 'networkMusic.settings.add', async () => {
          await this.api.networkMusicConfigure({ manualDevice: { action: 'add', url: this.manualUrl.value } });
          await this.refresh();
        });
        this.manualList = this.element('div', null, manual, 'network-settings-list');
      }
    }

    const settings = this.api.remoteV1?.settings;
    if (settings?.setConnection) {
      const connection = this.section('https');
      this.element('p', 'networkMusic.settings.httpsHelp', connection);
      this.endpoint = this.input(connection, 'endpoint', 'url');
      this.connectionControls = [this.endpoint];
      this.fileNames = {};
      for (const kind of ['certificate', 'key']) {
        const fileRow = this.element('div', null, connection, 'network-settings-file-row');
        this.connectionControls.push(this.button(fileRow, `networkMusic.settings.${kind}`, async () => {
          const selected = await settings.selectConnectionFile(kind);
          if (selected && !this.closed) {
            this[`${kind}Selection`] = selected.selectionId;
            this.fileNames[kind].textContent = selected.fileName;
          }
        }));
        this.fileNames[kind] = this.element('span', null, fileRow);
      }
      const actions = this.element('div', null, connection, 'network-settings-actions');
      this.connectionControls.push(this.button(actions, 'networkMusic.save', async () => {
        await settings.setConnection({ endpoint: this.endpoint.value, certificateSelection: this.certificateSelection,
          keySelection: this.keySelection });
        this.certificateSelection = this.keySelection = undefined;
        await this.remoteSettings.update(() => settings.getStatus());
      }));
      this.connectionControls.push(this.button(actions, 'networkMusic.settings.clearTls', async () => {
        await settings.setConnection({ endpoint: '', clearTls: true });
        this.certificateSelection = this.keySelection = undefined;
        await this.remoteSettings.update(() => settings.getStatus());
      }));
      this.button(actions, 'networkMusic.settings.test', async () => {
        const result = await settings.testConnection();
        const key = result.ok ? 'connectionOk' : ({ 'certificate-expired': 'expired', 'certificate-hostname': 'hostnameMismatch',
          'invalid-certificate': 'invalidCertificate', 'missing-certificate': 'invalidCertificate', unreachable: 'unreachable' })[result.code] ?? 'connectionFailed';
        this.connectionStatus.textContent = this.translate(`networkMusic.settings.${key}`);
      });
      this.connectionStatus = this.element('p', null, connection);
      this.connectionStatus.setAttribute('role', 'status');
      this.environmentNotice = this.element('p', 'networkMusic.settings.environment', connection);
      this.unsubscribe = this.remoteSettings.subscribe(() => this.renderConnection());
    }
    this.status = this.element('p', null, this.root, 'network-settings-status');
    this.status.setAttribute('role', 'status');
    return this.refresh();
  }

  renderConnection() {
    if (this.closed || !this.endpoint) return;
    const connection = this.remoteSettings.status?.connection;
    this.endpoint.value = connection?.endpoint ?? '';
    for (const control of this.connectionControls) control.disabled = !connection || connection.fromEnvironment === true;
    this.environmentNotice.hidden = connection?.fromEnvironment !== true;
    for (const kind of ['certificate', 'key']) {
      if (!this[`${kind}Selection`]) this.fileNames[kind].textContent = connection?.[`${kind}Name`] ?? '';
    }
  }

  async refresh() {
    if (!this.api.networkMusicConfigure) return;
    try {
      const state = await this.api.networkMusicGetState();
      if (this.closed) return;
      if (this.allowLibraries) this.allowLibraries.checked = state.gatewayPermissions?.libraries === true;
      if (this.allowPlayers) this.allowPlayers.checked = state.gatewayPermissions?.players === true;
      for (const [list, entries, kind] of [[this.sourceList, state.sources ?? [], 'subsonic'], [this.manualList, state.manualDevices ?? [], 'manualDevice']]) {
        if (!list) continue;
        list.replaceChildren();
        for (const entry of entries) {
          const row = this.element('div', null, list, 'network-settings-entry');
          this.element('span', null, row).textContent = entry.name || entry.url;
          const actions = this.element('div', null, row, 'network-settings-actions');
          if (kind === 'subsonic') this.button(actions, 'networkMusic.settings.test', async () => {
            await this.api.networkMusicConfigure({ subsonic: { action: 'test', id: entry.id } });
          });
          this.button(actions, 'networkMusic.remove', async () => {
            await this.api.networkMusicConfigure({ [kind]: { action: 'remove', id: entry.id } });
            await this.refresh();
          });
        }
      }
    } catch (error) {
      console.error('Failed to load network connection settings:', error);
      if (!this.closed && this.status) this.status.textContent = this.translate('networkMusic.settings.failed');
    }
  }

  updateLanguage() { for (const [element, key] of this.labels) element.textContent = this.translate(key); }
  dispose() {
    this.closed = true;
    this.unsubscribe?.();
    if (this.sourcePassword) this.sourcePassword.value = '';
    this.api.cancelSourceRegistration?.();
  }
}

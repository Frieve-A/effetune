// Mount the existing editor in its own document. The local audio pipeline and
// its remote-v1 server keep their original owners while another player is shown.
export class IntegratedRemoteEffects {
    constructor({ container, api = globalThis.window?.electronAPI?.remoteClient, translate = (_key, fallback) => fallback, reportError = () => {} }) {
        this.container = container;
        this.api = api;
        this.translate = translate;
        this.reportError = reportError;
        this.generation = 0;
        this.requestId = null;
        this.connectionId = null;
        this.port = null;
        this.frame = null;
        this.unsubscribe = null;
        this.window = container.ownerDocument.defaultView;
        this.frameOrigin = this.window.location.protocol === 'file:' ? 'null' : this.window.location.origin;
        this.unsubscribeLayoutMode = this.window.uiManager?.layoutMode?.onChange?.(() => this.updateFrameMetadata());
        this.onMessage = event => this.acceptFrame(event);
        this.window.addEventListener('message', this.onMessage);
    }

    text(key, fallback) { return this.translate(`ui.network.${key}`, fallback); }

    get playerTitle() { return `Effect Pipeline · ${this.player.name}`; }

    get frameMetadata() {
        return { playerName: this.player.name, layoutMode: this.window.uiManager?.layoutMode?.isMobile ? 'mobile' : 'desktop' };
    }

    updateFrameMetadata() {
        if (this.port) this.port.postMessage({ type: 'metadata', ...this.frameMetadata });
    }

    async selectPlayer(player) {
        const generation = ++this.generation;
        this.clearConnection();
        this.player = player;
        this.container.replaceChildren();
        this.container.hidden = !player;
        if (!player) return;
        if (!this.api) return this.showMessage('Effect editing unavailable', this.text('effectsUnavailable', 'Effect editing is unavailable for this player.'));
        this.showMessage('Connecting', this.text('effectsConnecting', 'Connecting to effects…'));
        try {
            const connection = await this.api.getConnection(player.id);
            if (generation !== this.generation) return;
            if (!connection.registered) this.showRegistration(connection.requestAvailable === false ? 'unavailable' : null);
            else this.mountEditor();
        } catch (error) {
            console.warn('[remote-client] connection lookup failed', error);
            if (generation === this.generation) this.showRegistration();
        }
    }

    createHeader() {
        const document = this.container.ownerDocument;
        const header = document.createElement('div');
        header.className = 'pipeline-header';
        const title = document.createElement('h2');
        title.className = 'pipeline-title';
        title.textContent = this.playerTitle;
        title.title = this.text('effectsTitle', 'Effect Pipeline');
        this.title = title;
        header.append(title);
        return header;
    }

    updatePlayerName(name) {
        if (!this.player || this.player.name === name) return;
        this.player = { ...this.player, name };
        if (this.title) this.title.textContent = this.playerTitle;
        if (this.frame) this.frame.title = this.playerTitle;
        this.updateFrameMetadata();
    }

    showMessage(text, hint = text) {
        const paragraph = this.container.ownerDocument.createElement('span');
        paragraph.textContent = text;
        paragraph.title = hint;
        paragraph.setAttribute('role', 'status');
        this.container.replaceChildren(this.createHeader(), paragraph);
    }

    showRegistration(requestStatus = null, reportFailure = false) {
        const document = this.container.ownerDocument;
        this.container.replaceChildren(this.createHeader());
        if (this.api.manageConnection) {
            this.showMessage('Connection unavailable', this.text('effectsError', 'Check the selected device and update its connection link.'));
            const repair = document.createElement('button');
            repair.className = 'header-button';
            repair.type = 'button';
            repair.textContent = 'Update connection';
            repair.title = this.text('changeConnection', 'Reconnect to this player’s effects.');
            repair.addEventListener('click', () => this.changeConnection());
            this.container.append(repair);
            return;
        }
        const form = document.createElement('form');
        form.className = 'remote-control-join-row';
        const pending = requestStatus === 'pending';
        const statuses = {
            pending: ['Waiting for approval', 'effectsApprovalPending', 'Approve the connection request on the selected player.'],
            denied: ['Permission denied', 'effectsApprovalDenied', 'The player denied the connection request. Try again and choose Allow on the player.'],
            expired: ['Request expired', 'effectsApprovalExpired', 'The connection request expired. Try again and choose Allow on the player.'],
            busy: ['Player busy', 'effectsApprovalBusy', 'The player is already handling another connection request. Wait a moment, then try again.'],
            unavailable: ['Effect editing unavailable', 'effectsRequestUnavailable', 'Check that Allow remote control is enabled in Settings > Config... > Network on the selected player, then refresh devices and try again. A version that supports connection requests is required.'],
            error: ['Connection failed', 'effectsError', 'Could not connect to effects. Check that the player is available and Remote Control is enabled, then try again.']
        };
        if (requestStatus) {
            const [label, key, hint] = statuses[requestStatus] || statuses.error;
            const status = document.createElement('span');
            status.className = pending ? 'remote-control-help' : 'remote-control-error';
            status.textContent = label;
            status.title = this.text(key, hint);
            status.setAttribute('role', 'status');
            form.append(status);
            if (reportFailure && requestStatus === 'unavailable') this.reportError(status.title);
        }
        const button = document.createElement('button');
        button.className = 'header-button';
        button.type = pending ? 'button' : 'submit';
        button.textContent = pending ? 'Cancel' : 'Connect effects';
        button.title = pending
            ? this.text('cancelEffectsRequest', 'Cancel the connection request.')
            : this.text('connectEffects', 'Request permission from the selected EffeTune player to edit its effects. Choose Allow on that player to connect.');
        if (pending) button.addEventListener('click', () => {
            this.cancelRequest();
            this.showRegistration();
        });
        form.append(button);
        form.addEventListener('submit', event => {
            event.preventDefault();
            return this.requestConnection();
        });
        this.container.append(form);
    }

    async requestConnection() {
        if (this.requestId) return;
        const generation = this.generation;
        const requestId = crypto.randomUUID();
        this.requestId = requestId;
        this.showRegistration('pending');
        let result;
        try {
            result = await this.api.requestConnection(this.player.id, requestId);
        } catch (error) {
            console.warn('[remote-client] connection request failed', error);
            result = { ok: false, status: 'error' };
        }
        if (generation !== this.generation || requestId !== this.requestId) return;
        this.requestId = null;
        if (result.ok) this.mountEditor();
        else this.showRegistration(result.status === 'cancelled' ? null : result.status || 'error', true);
    }

    cancelRequest() {
        if (!this.requestId) return;
        const requestId = this.requestId;
        this.requestId = null;
        void this.api.cancelConnectionRequest(requestId).catch(error => {
            console.warn('[remote-client] connection request cancellation failed', error);
        });
    }

    mountEditor() {
        const document = this.container.ownerDocument;
        this.container.replaceChildren();
        this.title = null;
        this.frame = document.createElement('iframe');
        this.frame.title = this.playerTitle;
        this.frame.className = 'integrated-remote-effects-frame';
        this.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-modals');
        this.frame.src = 'remote.html?integrated=1';
        this.container.append(this.frame);
    }

    changeConnection() {
        if (this.api.manageConnection) { this.api.manageConnection(this.player.id); return; }
        this.generation += 1;
        this.clearConnection();
        this.showRegistration();
    }

    acceptFrame(event) {
        if (event.source !== this.frame?.contentWindow || event.origin !== this.frameOrigin ||
            event.data?.type !== 'effetune-remote-ready' || this.port) return;
        const channel = new this.window.MessageChannel();
        const generation = this.generation;
        const port = channel.port1;
        this.port = port;
        let attempt = 0;
        let buffered = [];
        let connecting = false;
        this.unsubscribe = this.api.onEvent(message => {
            if (generation !== this.generation) return;
            if (connecting) buffered.push(message);
            else if (message.connectionId === this.connectionId) port.postMessage(message);
        });
        port.onmessage = async ({ data }) => {
            if (generation !== this.generation) return;
            if (data.type === 'change-connection') {
                this.changeConnection();
            } else if (data.type === 'connect') {
                const currentAttempt = ++attempt;
                connecting = true;
                buffered = [];
                try {
                    const result = await this.api.connect(this.player.id);
                    if (generation !== this.generation || currentAttempt !== attempt) {
                        if (result.connectionId) await this.api.disconnect(result.connectionId);
                        return;
                    }
                    connecting = false;
                    if (!result.ok) { port.postMessage({ type: 'close', code: 4401 }); return; }
                    this.connectionId = result.connectionId;
                    for (const message of buffered) if (message.connectionId === result.connectionId) port.postMessage(message);
                    buffered = [];
                } catch (error) {
                    if (generation !== this.generation || currentAttempt !== attempt) return;
                    console.warn('[remote-client] connection failed', error);
                    connecting = false;
                    port.postMessage({ type: 'close', code: 1006 });
                }
            } else if (data.type === 'send' && this.connectionId) {
                const id = this.connectionId;
                const sent = await this.api.send(id, data.data).catch(() => false);
                if (!sent && generation === this.generation && id === this.connectionId) port.postMessage({ type: 'close', code: 1006 });
            } else if (data.type === 'close') {
                attempt += 1;
                if (this.connectionId) void this.api.disconnect(this.connectionId);
                this.connectionId = null;
            }
        };
        const origin = this.frameOrigin;
        this.frame.contentWindow.postMessage({ type: 'effetune-remote-port', ...this.frameMetadata }, origin === 'null' ? '*' : origin, [channel.port2]);
    }

    clearConnection() {
        this.cancelRequest();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.port?.close();
        this.port = null;
        if (this.connectionId) void this.api.disconnect(this.connectionId).catch(() => {});
        this.connectionId = null;
        this.frame?.remove();
        this.frame = null;
    }

    dispose() {
        this.generation += 1;
        this.clearConnection();
        this.window.removeEventListener('message', this.onMessage);
        this.unsubscribeLayoutMode?.();
        this.container.replaceChildren();
    }
}

import { getAndroidBridge, isAndroidHost } from './bridge.js';

export function createAndroidNetworkOutput(bridge) {
    const request = (name, payload) => bridge.request('network.output.' + name, payload);
    const permission = () => bridge.request('network.ensurePermission', { request: true });
    let pickerRevision = 0;
    return {
        getStatus: () => request('getStatus'),
        getClock: async () => (await request('getClock')).time,
        updateRoute: route => request('updateRoute', route),
        onStatus: listener => bridge.on('network-status', listener),
        async setPickerOpen(open) {
            const revision = ++pickerRevision;
            if (open) {
                await permission();
                if (revision !== pickerRevision) return request('getStatus');
            }
            return request('setPickerOpen', { open });
        },
        async setConfiguration(patch) {
            if (patch.enabled) await permission();
            return request('setConfiguration', patch);
        },
        async setTargetEnabled(id, enabled) {
            if (enabled) await permission();
            return request('setTargetEnabled', { id, enabled });
        },
        resync: () => request('resync'),
        rendererReady: () => request('rendererReady'),
        rendererUnavailable() {
            pickerRevision++;
            return request('rendererUnavailable');
        },
        setReceiveSession: ({ active, generation }) => request('setReceiveSession', { active, generation }),
        onReport: listener => bridge.on('network-report', listener)
    };
}

let androidOutput;
export function getNetworkOutputBridge(windowRef = globalThis.window) {
    if (!isAndroidHost(windowRef)) return windowRef?.electronAPI?.networkOutputV1;
    return androidOutput ??= createAndroidNetworkOutput(getAndroidBridge());
}

// The service also owns the transport while the WebView is detached.
export function attachAndroidNetworkOutput(manager, bridge) {
    let generation = manager._networkReceiveSession?.generation ?? 0;
    const receive = () => {
        const session = manager._networkReceiveSession;
        if (!session || session.generation === generation) return;
        generation = session.generation;
        void bridge.setReceiveSession(session).catch(error => console.warn('Android receive routing failed', error));
    };
    manager.addEventListener('networkRoute', receive);
    const applyStatus = status => {
        if (typeof status?.enabled !== 'boolean') return;
        manager.setNetworkOutputLocalDelay?.(status.enabled, status.localDelayMs, status.localEnabled,
            status.syncDelayMs, status.syncRevision);
    };
    let receivedStatus = false;
    const removeStatus = bridge.onStatus(status => { receivedStatus = true; applyStatus(status); });
    const remove = bridge.onReport(report => {
        switch (report.type) {
        case 'networkRoute':
            if (report.generation > generation && manager._networkReceiveSession?.generation === 0) {
                generation = report.generation;
                manager._networkReceiveSession = { active: report.receiveActive, generation, sessionId: null };
            }
            if (report.generation !== manager._networkReceiveSession?.generation) return;
            manager.networkRoute = report;
            manager._appliedNetworkDelay = { ...manager._appliedNetworkDelay, worklet: null, localDelaySamples: report.localDelaySamples };
            if (manager.telemetryHub) manager.telemetryHub.routeRevision = report.revision;
            manager.telemetryHub?.clearVisualSyncQueue?.();
            manager.dispatchEvent('networkRoute', report);
            break;
        case 'networkPaths':
            manager.networkPaths = report;
            manager.dispatchEvent('networkPaths', report);
            break;
        case 'networkDelayApplied':
            manager._appliedNetworkDelay = { worklet: null, ...report };
            break;
        case 'dspLatency':
            manager.dspLatencyTaps = report.taps;
            manager.telemetryHub?.setSources?.(report.taps);
            manager.acceptPipelineStats({ latencySamples: report.samples, compensated: report.compensated, sampleRate: report.sampleRate });
            break;
        }
    });
    void bridge.rendererReady().then(status => {
        if (!receivedStatus) applyStatus(status);
    }).catch(error => console.warn('Android network reports unavailable', error));
    return () => {
        remove();
        removeStatus();
        manager.removeEventListener('networkRoute', receive);
        void bridge.rendererUnavailable().catch(error => console.warn('Android network controls closed', error));
    };
}

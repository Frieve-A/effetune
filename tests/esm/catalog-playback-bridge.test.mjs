import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogPlaybackBridge } from '../../js/ui/audio-player/catalog-playback-bridge.js';
import { StateManager } from '../../js/ui/audio-player/state-manager.js';
import { DurableActionController } from '../../js/ui/library/durable-action-controller.js';

const selectionDescriptor = Object.freeze({
  mode: 'all',
  contextToken: 'context-1',
  exclusions: Object.freeze([])
});

function playbackRequest(operationKind = 'play') {
  return {
    clientRequestId: 'legacy-renderer-id',
    operationKind,
    selectionDescriptor,
    target: {},
    expectedTargetVersion: 17,
    options: {}
  };
}

function successfulTerminal(overrides = {}) {
  return {
    operationKind: overrides.operationKind ?? 'play',
    destination: overrides.destination ?? 'replace',
    sequenceId: overrides.sequenceId ?? 'sequence-1',
    itemCount: overrides.itemCount ?? 1_000_000,
    firstOrdinal: overrides.firstOrdinal ?? 42,
    firstEntry: overrides.firstEntry ?? {
      entryInstanceId: 'entry-1',
      trackUid: 'track-1'
    },
    shuffleSeed: overrides.shuffleSeed ?? 0
  };
}

function sequenceClient(overrides = {}) {
  return {
    async readSequencePage(request) {
      return overrides.readSequencePage?.(request) ?? { items: [] };
    },
    async resolveSequenceEntrySource(request) {
      return overrides.resolveSequenceEntrySource?.(request) ?? { path: '/music/track.flac' };
    }
  };
}

function stalledPlaybackBridge({ install, commit, status, requestFolderAccess, client } = {}) {
  let workerListener;
  let finishProvisional;
  const events = [];
  const messages = [];
  const firstEntry = { entryInstanceId: 'entry-stall', trackUid: 'track-stall' };
  const terminal = { state: 'succeeded', result: successfulTerminal({ firstEntry, firstOrdinal: 0 }) };
  const stateManager = new StateManager({});
  const player = {
    stateManager,
    ui: { container: {} },
    playbackManager: {
      installBulkPlayProvisional: install ?? (() => new Promise(resolve => { finishProvisional = resolve; })),
      commitCatalogDestination: commit ?? (async () => ({ accepted: true })),
      async cancelBulkPlay() {},
      async finishBulkPlayTerminal() {},
      canUndoSessionTransport: () => true
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: player, showTransientMessage: key => messages.push(key) },
    service: {
      async start() { return { kind: 'started', operationId: 'operation-stall', provisionalEntry: firstEntry }; },
      status: status ?? (async () => ({ terminalKind: 'succeeded', result: terminal, finishedAt: 1 })),
      async cancel() { return { kind: 'tooLate' }; },
      subscribeOperation(_id, listener) { workerListener = listener; return () => {}; }
    },
    sequenceClient: client ?? sequenceClient(),
    requestFolderAccess
  });
  return {
    bridge, player, events, messages, terminal,
    finish: value => finishProvisional(value),
    emit: () => workerListener({ kind: 'terminal', operationId: 'operation-stall', result: terminal })
  };
}

test('pending playback exposes a cancellable waiting phase after worker completion and never forwards late success', async () => {
  const scenario = stalledPlaybackBridge();
  let clock = 0;
  let tick;
  const controller = new DurableActionController({
    service: {
      startLibraryOperation: request => scenario.bridge.start(request),
      getLibraryOperationStatus: id => scenario.bridge.status(id),
      subscribeLibraryOperation: (id, listener) => scenario.bridge.subscribeOperation(id, listener),
      cancelLibraryOperation: id => scenario.bridge.cancel(id),
      canUndoPlaybackSession: () => scenario.bridge.canUndoPlaybackSession()
    },
    now: () => clock,
    setIntervalFn: fn => { tick = fn; return 1; },
    clearIntervalFn() {}
  });
  await controller.track({
    ...playbackRequest(),
    start: () => scenario.bridge.start(playbackRequest())
  });
  scenario.bridge.subscribeOperation('operation-stall', event => scenario.events.push(event));
  scenario.emit();
  assert.equal((await scenario.bridge.status('operation-stall')).phase, 'STARTING_PLAYBACK');
  clock = 30_000;
  tick();
  assert.equal(controller.state.status, 'waiting');
  await controller.cancel();
  assert.equal(controller.state.status, 'terminal');
  assert.equal(controller.state.terminalKind, 'cancelled');
  assert.equal(scenario.player.stateManager.state.isPlaybackPending, false);
  scenario.finish({ accepted: true });
  scenario.emit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.events.filter(event => event.kind === 'terminal').length, 1);
  assert.equal((await scenario.bridge.status('operation-stall')).terminalKind, 'cancelled');
  controller.close();
  scenario.bridge.close();
});

test('playback deadline terminates an unresponsive source/status request with its stage', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(console, 'error', () => {});
  const scenario = stalledPlaybackBridge({
    status: () => new Promise(() => {}),
    install: options => {
      options.onStage('sourceResolve');
      return new Promise(() => {});
    }
  });
  await scenario.bridge.start(playbackRequest());
  scenario.bridge.subscribeOperation('operation-stall', event => scenario.events.push(event));
  t.mock.timers.tick(45_000);
  await new Promise(resolve => setImmediate(resolve));
  const status = await scenario.bridge.status('operation-stall');
  assert.equal(status.terminalKind, 'failed');
  assert.equal(status.result.code, 'playbackStartTimeout:sourceResolve');
  assert.equal(scenario.events.filter(event => event.kind === 'terminal').length, 1);
  assert.deepEqual(scenario.messages, ['library.error.playbackStartTimeout']);
  assert.equal(scenario.player.stateManager.state.isPlaybackPending, false);
  scenario.bridge.close();
});

test('ALAC provisional playback failure shows the dedicated macOS desktop message', async t => {
  t.mock.method(console, 'error', () => {});
  const scenario = stalledPlaybackBridge({
    async install() {
      throw Object.assign(new Error('ALAC requires macOS desktop'), { code: 'alacRequiresMacDesktop' });
    }
  });
  t.after(() => scenario.bridge.close());
  await scenario.bridge.start(playbackRequest());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await scenario.bridge.status('operation-stall')).terminalKind, 'failed');
  assert.deepEqual(scenario.messages, ['error.alacRequiresMacDesktop']);
});

test('permission UI pauses the playback deadline and cancellation blocks a late source retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let resolvePermission;
  let changeInteraction;
  let resolutions = 0;
  const scenario = stalledPlaybackBridge({
    install: options => options.resolveSource(options.receipt.provisionalEntry, options.resolutionScope, options.signal),
    client: sequenceClient({ resolveSequenceEntrySource() {
      resolutions += 1;
      throw Object.assign(new Error('permission'), {
        code: 'folderPermissionRequired', details: { folderId: 'folder-1', lifecycleVersion: 1 }
      });
    } }),
    requestFolderAccess(_id, { onUserInteractionChange }) {
      changeInteraction = onUserInteractionChange;
      onUserInteractionChange(true);
      return new Promise(resolve => { resolvePermission = resolve; });
    }
  });
  await scenario.bridge.start(playbackRequest());
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  assert.equal((await scenario.bridge.status('operation-stall')).terminalKind, undefined);
  await scenario.bridge.cancel('operation-stall');
  changeInteraction(false);
  resolvePermission({ folder: { id: 'folder-1', lifecycleVersion: 1, status: 'active' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolutions, 1);
  assert.equal((await scenario.bridge.status('operation-stall')).terminalKind, 'cancelled');
  scenario.bridge.close();
});

test('commit waiting is bounded and close aborts an unresolved provisional', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(console, 'error', () => {});
  let commits = 0;
  let releaseCommit;
  const scenario = stalledPlaybackBridge({
    install: async () => ({ accepted: true }),
    commit: () => { commits += 1; return new Promise(resolve => { releaseCommit = resolve; }); }
  });
  await scenario.bridge.start(playbackRequest());
  scenario.bridge.subscribeOperation('operation-stall', event => scenario.events.push(event));
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(45_000);
  releaseCommit({ accepted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commits, 1);
  assert.equal((await scenario.bridge.status('operation-stall')).terminalKind, 'failed');
  assert.equal(scenario.events.filter(event => event.kind === 'terminal').length, 1);
  scenario.bridge.close();
  const closed = stalledPlaybackBridge();
  await closed.bridge.start(playbackRequest());
  closed.bridge.close();
  assert.equal(closed.player.stateManager.state.isPlaybackPending, false);
  closed.finish({ accepted: true });
});

test('permission completion resumes the paused playback deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(console, 'error', () => {});
  let finishPermission;
  let resolutions = 0;
  const scenario = stalledPlaybackBridge({
    install: options => options.resolveSource(options.receipt.provisionalEntry, options.resolutionScope, options.signal),
    client: sequenceClient({ resolveSequenceEntrySource() {
      resolutions += 1;
      if (resolutions > 1) return new Promise(() => {});
      throw Object.assign(new Error('permission'), {
        code: 'folderPermissionRequired', details: { folderId: 'folder-1', lifecycleVersion: 1 }
      });
    } }),
    requestFolderAccess(_id, { onUserInteractionChange }) {
      onUserInteractionChange(true);
      return new Promise(resolve => { finishPermission = () => {
        onUserInteractionChange(false);
        resolve({ folder: { id: 'folder-1', lifecycleVersion: 1, status: 'active' } });
      }; });
    }
  });
  await scenario.bridge.start(playbackRequest());
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  finishPermission();
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(44_999);
  assert.equal((await scenario.bridge.status('operation-stall')).terminalKind, undefined);
  t.mock.timers.tick(1);
  assert.equal((await scenario.bridge.status('operation-stall')).result.code, 'playbackStartTimeout:sourceResolve');
  scenario.bridge.close();
});

test('Library Play begins audio recovery before restored state and service work', async () => {
  const calls = [];
  let finishStateRestore;
  const player = {
    stateRestored: new Promise(resolve => { finishStateRestore = resolve; }),
    resumeAudioContextInGesture() {
      calls.push('resume');
      return Promise.resolve(true);
    },
    playbackManager: {}
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: player },
    service: {
      async start() {
        calls.push('start');
        return { kind: 'unavailable' };
      }
    },
    sequenceClient: sequenceClient()
  });

  const starting = bridge.start(playbackRequest());
  assert.deepEqual(calls, ['resume']);

  finishStateRestore();
  await starting;
  assert.deepEqual(calls, ['resume', 'start']);
});

test('Library Play stays pending from service queueing through provisional activation', async () => {
  let finishStart;
  let finishActivation;
  const service = {
    start() {
      return new Promise(resolve => { finishStart = resolve; });
    },
    async status() { return null; },
    subscribeOperation() { return () => {}; }
  };
  const stateManager = new StateManager({});
  const player = {
    stateManager,
    ui: { container: {} },
    playbackManager: {
      installBulkPlayProvisional() {
        return new Promise(resolve => { finishActivation = resolve; });
      }
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: player },
    service,
    sequenceClient: sequenceClient()
  });

  const starting = bridge.start(playbackRequest());
  assert.equal(stateManager.state.isPlaybackPending, true);

  finishStart({
    kind: 'started',
    operationId: 'operation-pending',
    provisionalEntry: { entryInstanceId: 'entry-pending', trackUid: 'track-pending' }
  });
  const receipt = await starting;
  assert.equal(receipt.operationId, 'operation-pending');
  assert.equal(stateManager.state.isPlaybackPending, true);

  finishActivation({ accepted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stateManager.state.isPlaybackPending, false);
});

test('playback start is session-only and publishes the terminal catalog sequence', async () => {
  const calls = [];
  let operationListener = null;
  const service = {
    async start(request) {
      calls.push(['start', request]);
      return { kind: 'started', operationId: 'operation-1' };
    },
    async getProvisionalEntry() {
      return { entryInstanceId: 'entry-1', trackUid: 'track-1', ordinal: 42 };
    },
    async status() { return null; },
    subscribeOperation(_operationId, listener) {
      operationListener = listener;
      return () => { operationListener = null; };
    }
  };
  const client = sequenceClient({
    resolveSequenceEntrySource(request) {
      calls.push(['resolve', request]);
      return { path: '/music/track-1.flac' };
    }
  });
  const player = {
    ui: { container: {} },
    playbackManager: {
      async installBulkPlayProvisional(options) {
        calls.push(['provisional', options.receipt.provisionalEntry]);
        await options.resolveSource(
          options.receipt.provisionalEntry,
          options.resolutionScope
        );
        return { accepted: true };
      },
      async commitCatalogDestination(options) {
        calls.push(['commit', options]);
        return { accepted: true };
      },
      async finishBulkPlayTerminal(operationId, options) {
        calls.push(['finish', operationId, options]);
        return true;
      }
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: player },
    service,
    sequenceClient: client
  });

  const receipt = await bridge.start(playbackRequest());
  assert.equal(receipt.operationId, 'operation-1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], ['start', {
    operationKind: 'play',
    selectionDescriptor,
    target: {},
    options: { playbackDestination: 'replace' }
  }]);
  operationListener({
    kind: 'terminal',
    operationId: 'operation-1',
    result: successfulTerminal()
  });
  await new Promise(resolve => setImmediate(resolve));

  const commit = calls.find(call => call[0] === 'commit')[1];
  assert.equal(commit.operationKind, 'play');
  assert.equal(commit.sequence.sequenceId, 'sequence-1');
  assert.equal(commit.sequence.itemCount, 1_000_000);
  assert.equal(commit.currentOrdinal, 42);
  assert.deepEqual(commit.firstEntry, { entryInstanceId: 'entry-1', trackUid: 'track-1' });
  assert.deepEqual(calls.find(call => call[0] === 'finish'), [
    'finish', 'operation-1', { succeeded: true }
  ]);
});

test('Play applies dedicated and restored player shuffle to the session sequence', async t => {
  const cases = [
    {
      name: 'dedicated Library Shuffle',
      requestOptions: { currentOrdinal: 6, seed: 71 },
      restoredShuffleMode: false,
      expectedSeed: 71
    },
    {
      name: 'ordinary Library Play with restored player shuffle',
      requestOptions: { currentOrdinal: 6 },
      restoredShuffleMode: true,
      expectedSeed: null
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let operationListener = null;
      let startedRequest = null;
      let committed = null;
      let shuffleMode = false;
      const firstEntry = { entryInstanceId: 'clicked-entry', trackUid: 'clicked-track' };
      const service = {
        async start(request) {
          startedRequest = request;
          return { kind: 'started', operationId: 'shuffle-operation' };
        },
        async getProvisionalEntry() { return firstEntry; },
        async status() { return null; },
        subscribeOperation(_operationId, listener) {
          operationListener = listener;
          return () => { operationListener = null; };
        }
      };
      const player = {
        stateRestored: Promise.resolve().then(() => {
          shuffleMode = scenario.restoredShuffleMode;
        }),
        stateManager: {
          getStateSnapshot() { return { shuffleMode }; }
        },
        ui: { container: {} },
        playbackManager: {
          async installBulkPlayProvisional() { return { accepted: true }; },
          async commitCatalogDestination(options) {
            committed = options;
            return { accepted: true };
          }
        }
      };
      const bridge = new CatalogPlaybackBridge({
        uiManager: { audioPlayer: player },
        service,
        sequenceClient: sequenceClient({
          readSequencePage({ ordinal, limit }) {
            return {
              items: Array.from({ length: limit }, (_, index) => {
                const canonicalOrdinal = ordinal + index;
                return canonicalOrdinal === 6
                  ? firstEntry
                  : {
                      entryInstanceId: `entry-${canonicalOrdinal}`,
                      trackUid: `track-${canonicalOrdinal}`
                    };
              })
            };
          }
        })
      });

      await bridge.start({
        ...playbackRequest(),
        options: scenario.requestOptions
      });
      const sessionSeed = startedRequest.options.seed;
      assert.equal(Number.isSafeInteger(sessionSeed), true);
      if (scenario.expectedSeed !== null) assert.equal(sessionSeed, scenario.expectedSeed);

      operationListener({
        kind: 'terminal',
        operationId: 'shuffle-operation',
        result: successfulTerminal({
          itemCount: 17,
          firstOrdinal: 6,
          firstEntry,
          shuffleSeed: sessionSeed
        })
      });
      await new Promise(resolve => setImmediate(resolve));

      const descriptor = committed.sequence.getDescriptor();
      assert.equal(descriptor.shuffleEnabled, true);
      assert.equal(descriptor.shuffleSeed, sessionSeed);
      assert.equal(committed.sequence.toCanonicalOrdinal(committed.currentOrdinal), 6);
      assert.equal((await committed.sequence.getEntry(committed.currentOrdinal)).entryInstanceId, 'clicked-entry');
      assert.deepEqual(committed.firstEntry, firstEntry);
    });
  }
});

test('terminal event and session status race commit one sequence', async () => {
  const terminal = successfulTerminal({ firstOrdinal: 0 });
  let commits = 0;
  let finishes = 0;
  const service = {
    async start() { return { kind: 'started', operationId: 'operation-race' }; },
    async getProvisionalEntry() { return terminal.firstEntry; },
    async status() {
      return {
        terminalKind: 'succeeded',
        finishedAt: 1,
        result: {
          state: 'succeeded',
          result: terminal,
          finishedAt: 1
        }
      };
    },
    subscribeOperation(operationId, listener) {
      setImmediate(() => listener({ kind: 'terminal', operationId, result: terminal }));
      return () => {};
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: {
        ui: { container: {} },
        playbackManager: {
          async installBulkPlayProvisional() { return { accepted: true }; },
          async commitCatalogDestination() {
            commits += 1;
            return { accepted: true };
          },
          async finishBulkPlayTerminal() {
            finishes += 1;
            return true;
          }
        }
      }
    },
    service,
    sequenceClient: sequenceClient()
  });

  await bridge.start(playbackRequest());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commits, 1);
  assert.equal(finishes, 1);
});

test('folder permission is requested once and the same provisional source is retried', async () => {
  const calls = [];
  let resolveCount = 0;
  let installed;
  const installation = new Promise(resolve => { installed = resolve; });
  const permissionError = Object.assign(new Error('permission required'), {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1', lifecycleVersion: 4 }
  });
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: {
        ui: { container: {} },
        playbackManager: {
          async installBulkPlayProvisional(options) {
            const source = await options.resolveSource(
              options.receipt.provisionalEntry,
              options.resolutionScope
            );
            installed(source);
            return { accepted: true };
          }
        }
      }
    },
    service: {
      async start() { return { kind: 'started', operationId: 'permission-operation' }; },
      async getProvisionalEntry() { return { entryInstanceId: 'entry-1', trackUid: 'track-1' }; },
      async status() { return null; },
      subscribeOperation() { return () => {}; }
    },
    sequenceClient: sequenceClient({
      resolveSequenceEntrySource(request) {
        resolveCount += 1;
        calls.push(['resolve', request.trackUid]);
        if (resolveCount === 1) throw permissionError;
        return { path: '/music/track-1.flac' };
      }
    }),
    async requestFolderAccess(folderId) {
      calls.push(['permission', folderId]);
      return { folder: { id: folderId, lifecycleVersion: 5, status: 'active' } };
    }
  });

  await bridge.start(playbackRequest());
  assert.deepEqual(await installation, { path: '/music/track-1.flac' });
  assert.deepEqual(calls, [
    ['resolve', 'track-1'],
    ['permission', 'folder-1'],
    ['resolve', 'track-1']
  ]);
});

test('one cancelled permission prompt is shared by a playback action but not the next action', async () => {
  let permissionPrompts = 0;
  let resolutionCalls = 0;
  let completedActions = 0;
  let complete;
  const completed = new Promise(resolve => { complete = resolve; });
  const permissionError = Object.assign(new Error('permission required'), {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1', lifecycleVersion: 8 }
  });
  const service = {
    nextOperation: 0,
    async start() {
      this.nextOperation += 1;
      return { kind: 'started', operationId: `operation-${this.nextOperation}` };
    },
    async getProvisionalEntry(operationId) {
      return { entryInstanceId: `${operationId}:entry`, trackUid: `${operationId}:track` };
    },
    async status() { return null; },
    subscribeOperation() { return () => {}; }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: {
        ui: { container: {} },
        playbackManager: {
          async installBulkPlayProvisional(options) {
            for (let index = 0; index < 2; index += 1) {
              await assert.rejects(
                options.resolveSource({
                  entryInstanceId: `${options.receipt.operationId}:${index}`,
                  trackUid: `track-${index}`
                }, options.resolutionScope),
                error => error === permissionError
              );
            }
            completedActions += 1;
            if (completedActions === 2) complete();
            return { accepted: true };
          }
        }
      }
    },
    service,
    sequenceClient: sequenceClient({
      resolveSequenceEntrySource() {
        resolutionCalls += 1;
        throw permissionError;
      }
    }),
    async requestFolderAccess() {
      permissionPrompts += 1;
      return { canceled: true };
    }
  });

  await bridge.start(playbackRequest());
  await bridge.start(playbackRequest());
  await completed;
  assert.equal(resolutionCalls, 4);
  assert.equal(permissionPrompts, 2);
});

test('aborting while folder permission is open prevents a late source retry', async () => {
  const controller = new AbortController();
  let releasePermission;
  let promptOpened;
  let resolutionCalls = 0;
  let settled;
  const opened = new Promise(resolve => { promptOpened = resolve; });
  const installationSettled = new Promise(resolve => { settled = resolve; });
  const permissionError = Object.assign(new Error('permission required'), {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1', lifecycleVersion: 2 }
  });
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: {
        ui: { container: {} },
        playbackManager: {
          async installBulkPlayProvisional(options) {
            try {
              await options.resolveSource(
                options.receipt.provisionalEntry,
                options.resolutionScope,
                controller.signal
              );
            } finally {
              settled();
            }
            return { accepted: true };
          }
        }
      },
      showTransientMessage() {}
    },
    service: {
      async start() { return { kind: 'started', operationId: 'abort-operation' }; },
      async getProvisionalEntry() { return { entryInstanceId: 'entry-1', trackUid: 'track-1' }; },
      async status() { return null; },
      async cancel() {},
      subscribeOperation() { return () => {}; }
    },
    sequenceClient: sequenceClient({
      resolveSequenceEntrySource() {
        resolutionCalls += 1;
        throw permissionError;
      }
    }),
    requestFolderAccess() {
      promptOpened();
      return new Promise(resolve => { releasePermission = resolve; });
    }
  });

  await bridge.start(playbackRequest());
  await opened;
  controller.abort();
  releasePermission({ folder: { id: 'folder-1', lifecycleVersion: 2, status: 'active' } });
  await installationSettled;
  assert.equal(resolutionCalls, 1);
});

test('failed provisional activation ends the session operation without transport recovery', async () => {
  const calls = [];
  let listener = null;
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: {
        ui: { container: {} },
        playbackManager: {
          async installBulkPlayProvisional() {
            throw Object.assign(new Error('activation failed'), { code: 'mediaActivationFailed' });
          },
          async finishBulkPlayTerminal(operationId, options) {
            calls.push(['finish', operationId, options]);
            return true;
          }
        }
      },
      showTransientMessage() {}
    },
    service: {
      async start() { return { kind: 'started', operationId: 'failed-operation' }; },
      async getProvisionalEntry() { return { entryInstanceId: 'entry-1', trackUid: 'track-1' }; },
      async status() { return null; },
      async cancel(operationId) {
        calls.push(['cancel', operationId]);
        return { kind: 'cancelRequested' };
      },
      subscribeOperation(_operationId, callback) {
        listener = callback;
        return () => { listener = null; };
      }
    },
    sequenceClient: sequenceClient()
  });

  await bridge.start(playbackRequest());
  const lateListener = listener;
  await new Promise(resolve => setImmediate(resolve));
  lateListener({ kind: 'terminal', operationId: 'failed-operation', result: { state: 'failed' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call[0] === 'cancel').length, 1);
  assert.deepEqual(calls.find(call => call[0] === 'finish'), ['finish', 'failed-operation', { succeeded: false }]);
  assert.equal((await bridge.status('failed-operation')).result.state, 'failed');
  assert.equal(bridge.restoreTransport, undefined);
});

test('Save Queue retains durable IDs and normalizes the active catalog segment', async () => {
  const starts = [];
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: {} },
    service: {
      async start(request) {
        starts.push(request);
        return { kind: 'started', operationId: 'save-operation' };
      }
    },
    sequenceClient: sequenceClient()
  });

  await bridge.saveActiveSequenceAsPlaylist({
    name: 'Road trip',
    playlistId: 'playlist-1',
    expectedVersion: 3,
    clientRequestId: 'save-request',
    saveId: 'save-id',
    sequenceDescriptor: {
      kind: 'catalog',
      sequenceId: 'sequence-save',
      itemCount: 500,
      shuffleEnabled: true,
      shuffleSeed: 7,
      shuffleEpoch: 2,
      shuffleTransportOffset: 1
    }
  });

  assert.deepEqual(starts[0], {
    clientRequestId: 'save-request',
    operationKind: 'addToPlaylist',
    selectionDescriptor: null,
    target: { playlistId: 'playlist-1' },
    expectedTargetVersion: 3,
    options: {
      saveId: 'save-id',
      name: 'Road trip',
      sourceSequenceDescriptor: {
        segments: [{
          sequenceId: 'sequence-save',
          startOrdinal: 0,
          endOrdinal: 500,
          shuffleSeed: 7,
          shuffleEpoch: 2,
          shuffleTransportOffset: 1
        }]
      }
    }
  });
});

test('Save Queue rejects more than 256 distinct source segments', async () => {
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: {} },
    service: { async start() { throw new Error('must not start'); } },
    sequenceClient: sequenceClient()
  });
  const segments = Array.from({ length: 257 }, (_, index) => ({
    itemCount: 1,
    startOrdinal: 0,
    source: {
      kind: 'catalog',
      sequenceId: `sequence-${index}`,
      itemCount: 1,
      shuffleEnabled: false
    }
  }));

  await assert.rejects(
    bridge.saveActiveSequenceAsPlaylist({
      name: 'Too large',
      playlistId: 'playlist-1',
      expectedVersion: 0,
      clientRequestId: 'save-request',
      saveId: 'save-id',
      sequenceDescriptor: {
        kind: 'composite',
        sequenceId: 'composite-save',
        itemCount: 257,
        segments
      }
    }),
    error => error.code === 'sequenceSegmentLimitExceeded'
  );
});

test('a missing session transport is reported without creating an audio player', () => {
  let created = 0;
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: null,
      createAudioPlayer() {
        created += 1;
        return Promise.resolve({ playbackManager: {} });
      }
    },
    service: { async start() { throw new Error('must not start'); } },
    sequenceClient: sequenceClient()
  });

  assert.equal(bridge.canUndoPlaybackSession(), false);
  assert.equal(created, 0);
});

test('Library Play resumes audio before awaiting the player that loads on demand', async () => {
  const calls = [];
  let finishLoading;
  const player = {
    playbackManager: {},
    resumeAudioContextInGesture() {
      calls.push('resume');
      return Promise.resolve(true);
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: null,
      beginPlaybackSelectionGestureResume() {
        calls.push('resume');
        return Promise.resolve(true);
      },
      async createAudioPlayer() {
        calls.push('create');
        await new Promise(resolve => { finishLoading = resolve; });
        return player;
      }
    },
    service: {
      async start() {
        calls.push('start');
        return { kind: 'unavailable' };
      }
    },
    sequenceClient: sequenceClient()
  });

  const started = bridge.start(playbackRequest());
  assert.deepEqual(calls, ['resume', 'create']);
  finishLoading();
  await started;
  assert.deepEqual(calls, ['resume', 'create', 'start']);
  assert.equal(player.libraryOperationService, bridge);
});

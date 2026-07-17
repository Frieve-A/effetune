import assert from 'node:assert/strict';

const CUE_REGION_SMOKE_FIXTURE_PATH = '/__cue-region-smoke__/index.html';

async function runBrowserScenario(page) {
  return page.evaluate(async () => {
    const [{ AudioContextManager }, { PlaybackManager }, { CatalogPlaybackBridge }] = await Promise.all([
      import('/js/ui/audio-player/audio-context-manager.js'),
      import('/js/ui/audio-player/playback-manager.js'),
      import('/js/ui/audio-player/catalog-playback-bridge.js')
    ]);
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };

    const waitFor = async (predicate, label, timeoutMs = 8_000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for ${label}.`);
    };

    const waitForMetadata = activeRegion => Promise.race([
      activeRegion.metadataPromise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Timed out waiting for media metadata.')),
        5_000
      ))
    ]);

    const createWavFile = (name, durationSec, frequency) => {
      const sampleRate = 8_000;
      const sampleCount = Math.round(sampleRate * durationSec);
      const bytes = new ArrayBuffer(44 + sampleCount * 2);
      const view = new DataView(bytes);
      const writeText = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };
      writeText(0, 'RIFF');
      view.setUint32(4, 36 + sampleCount * 2, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeText(36, 'data');
      view.setUint32(40, sampleCount * 2, true);
      for (let index = 0; index < sampleCount; index += 1) {
        const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.08;
        view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true);
      }
      return new File([bytes], name, { type: 'audio/wav', lastModified: 1_700_000_000_000 });
    };

    const originalLoad = HTMLMediaElement.prototype.load;
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    let loadCalls = 0;
    let objectUrlCreates = 0;
    let objectUrlRevokes = 0;
    HTMLMediaElement.prototype.load = function load() {
      loadCalls += 1;
      return originalLoad.call(this);
    };
    URL.createObjectURL = value => {
      objectUrlCreates += 1;
      return originalCreateObjectURL(value);
    };
    URL.revokeObjectURL = value => {
      objectUrlRevokes += 1;
      return originalRevokeObjectURL(value);
    };
    window.audioPreferences = { useInputWithPlayer: true };

    const openContexts = [];
    const ownedObjectUrls = new Set();

    const createHarness = tracks => {
      const transitionSnapshots = [];
      const state = {
        playlist: [],
        playlistLength: tracks.length,
        currentTrack: null,
        currentTrackIndex: 0,
        currentTrackDuration: 0,
        currentTrackPosition: 0,
        playbackMode: 'audioElement',
        isPlaying: false,
        isPaused: false,
        isStopped: false,
        isTransitioning: false,
        repeatMode: 'OFF',
        shuffleMode: false,
        transportCommandGeneration: 0
      };
      let audioPlayer;
      const stateManager = {
        getStateSnapshot() { return { ...state }; },
        getCurrentTrackIndex() { return state.currentTrackIndex; },
        updateState(updates) {
          const previousIndex = state.currentTrackIndex;
          Object.assign(state, updates);
          if (Number.isInteger(updates?.currentTrackIndex) &&
              updates.currentTrackIndex !== previousIndex && audioPlayer?.audioElement) {
            transitionSnapshots.push({
              index: updates.currentTrackIndex,
              currentTime: audioPlayer.audioElement.currentTime,
              src: audioPlayer.audioElement.src
            });
          }
        },
        updatePlaylist(playlist, currentTrackIndex) {
          Object.assign(state, {
            playlist,
            playlistLength: playlist.length,
            currentTrackIndex,
            currentTrack: playlist[currentTrackIndex] ?? null
          });
        },
        updateCatalogSequence({
          sequenceId,
          itemCount,
          currentOrdinal,
          currentTrack,
          playbackGeneration
        }) {
          Object.assign(state, {
            playlistLength: itemCount,
            currentTrackIndex: currentOrdinal,
            currentTrack,
            sequenceKind: 'catalog',
            sequenceId,
            playbackGeneration
          });
        },
        updateQueueWindow(queueWindow) {
          state.queueWindow = queueWindow;
        }
      };

      let context = new AudioContext();
      openContexts.push(context);
      let connectedSources = new WeakSet();
      const powerCalls = { automatic: 0, user: 0 };
      const audioManager = {
        audioContext: context,
        workletNode: null,
        sourceNode: null,
        powerPolicyController: {
          enabled: true,
          async ensureActiveForAutomaticPlayback() {
            powerCalls.automatic += 1;
            if (context.state === 'suspended') await context.resume();
            return true;
          },
          async ensureActive() {
            powerCalls.user += 1;
            if (context.state === 'suspended') await context.resume();
            return true;
          }
        },
        isStagedAudioActivationEnabled() { return false; },
        connectSourceToPipeline(source) {
          source.connect(this.workletNode);
          connectedSources.add(source);
          return true;
        },
        disconnectSourceFromPipeline(source) {
          try { source.disconnect(this.workletNode); } catch (_) { /* already disconnected */ }
          connectedSources.delete(source);
        },
        isSourceConnectedToPipeline(source) {
          return connectedSources.has(source);
        }
      };
      const installGraph = nextContext => {
        context = nextContext;
        connectedSources = new WeakSet();
        audioManager.audioContext = nextContext;
        audioManager.workletNode = nextContext.createGain();
        audioManager.workletNode.connect(nextContext.destination);
      };
      installGraph(context);

      const audioElement = document.createElement('audio');
      audioElement.preload = 'auto';
      document.body.append(audioElement);
      audioPlayer = {
        audioContext: context,
        audioElement,
        stateManager,
        playbackManager: null,
        contextManager: null,
        ui: {
          updatePlayerUIState() {},
          updatePlayPauseButton() {}
        }
      };
      const playbackManager = new PlaybackManager(audioPlayer);
      const manager = new AudioContextManager(audioPlayer, audioManager);
      audioPlayer.playbackManager = playbackManager;
      audioPlayer.contextManager = manager;
      manager.loadMetadata = () => {};
      manager.setupMediaSessionHandlers = () => {};
      manager.setupEventHandlers();

      const entries = tracks.map(track => playbackManager.createTrackEntry(track));
      playbackManager.playlist = entries;
      playbackManager.originalPlaylist = entries.map(
        track => playbackManager.createOriginalTrackEntry(track)
      );
      playbackManager.syncMaterializedSequence();
      Object.assign(state, {
        playlist: entries,
        currentTrack: entries[0],
        currentTrackIndex: 0
      });

      return {
        audioManager,
        audioPlayer,
        entries,
        installGraph,
        manager,
        playbackManager,
        powerCalls,
        state,
        transitionSnapshots
      };
    };

    const track = (name, file, physicalSourceKey, startFrame, endFrame, durationSec) => ({
      name,
      file,
      physicalSourceKey,
      startFrame,
      endFrame,
      durationSec,
      meta: { title: name }
    });

    const exerciseDelayedBoundaryPlan = async tracks => {
      const harness = createHarness(tracks);
      let resolvePlan;
      const delayedPlan = new Promise(resolve => { resolvePlan = resolve; });
      let currentCheckCount = 0;
      let plannedCommitCount = 0;
      let plannedTransitionCount = 0;
      let normalTransportCount = 0;
      let pauseCount = 0;
      harness.playbackManager.preparePlannedRegionMove = () => delayedPlan;
      harness.playbackManager.isPlannedRegionMoveCurrent = () => {
        currentCheckCount += 1;
        return true;
      };
      harness.playbackManager.isPlannedAutomaticMoveCurrent = () => {
        currentCheckCount += 1;
        return true;
      };
      harness.playbackManager.commitPlannedRegionMove = () => {
        plannedCommitCount += 1;
        return true;
      };
      harness.playbackManager.onTrackEnded = () => { normalTransportCount += 1; };
      harness.manager.transitionPreparedAutomaticMove = prepared => {
        check(prepared.automaticMovePlan?.nextOrdinal === 1, 'Pending plan snapshot was not reused.');
        plannedTransitionCount += 1;
        plannedCommitCount += 1;
        return Promise.resolve(true);
      };

      const audioElement = harness.audioPlayer.audioElement;
      const pause = audioElement.pause.bind(audioElement);
      audioElement.pause = () => {
        pauseCount += 1;
        pause();
      };
      check(harness.manager.setupAudioElement(harness.entries[0], 0), 'Delayed-plan setup failed.');
      const boundaryRegion = harness.manager.activeRegion;
      check(await waitForMetadata(boundaryRegion), 'Delayed-plan metadata validation failed.');
      ownedObjectUrls.add(harness.manager.currentObjectURL);
      Object.assign(harness.state, {
        currentTrackDuration: tracks[0].durationSec,
        currentTrackPosition: tracks[0].durationSec,
        isPlaying: true,
        isPaused: false,
        isStopped: false
      });
      audioElement.currentTime = tracks[0].endFrame / 75;
      harness.manager.regionBoundaryTimer = setTimeout(() => {}, 10_000);
      const boundaryResult = harness.manager.commitRegionBoundary(
        boundaryRegion.sourceGeneration,
        harness.manager.regionBoundaryArmToken
      );
      const immediate = {
        synchronous: boundaryResult === true,
        boundaryCommitted: boundaryRegion.boundaryCommitted,
        currentTime: audioElement.currentTime,
        logicalPosition: harness.state.currentTrackPosition,
        paused: audioElement.paused,
        pauseCount,
        timerCleared: harness.manager.regionBoundaryTimer === null,
        normalTransportCount,
        plannedCommitCount,
        plannedTransitionCount,
        currentCheckCount
      };

      resolvePlan({
        nextTrack: harness.entries[1],
        nextOrdinal: 1,
        preparedRequest: harness.manager.createPlaybackRequestSnapshot(harness.entries[1], 1)
      });
      await boundaryRegion.transportPlanPromise;
      await Promise.resolve();
      return {
        immediate,
        late: {
          transportPlan: boundaryRegion.transportPlan,
          transportPlanPending: boundaryRegion.transportPlanPending,
          normalTransportCount,
          plannedCommitCount,
          plannedTransitionCount,
          currentCheckCount
        }
      };
    };

    try {
      const albumFile = createWavFile('contiguous-album.wav', 4, 220);
      const contiguous = createHarness([]);
      const catalogEntries = [
        { entryInstanceId: 'cue-smoke-entry-0', trackUid: 'cue-smoke-track-0', title: 'One' },
        { entryInstanceId: 'cue-smoke-entry-1', trackUid: 'cue-smoke-track-1', title: 'Two' },
        { entryInstanceId: 'cue-smoke-entry-2', trackUid: 'cue-smoke-track-2', title: 'Three' }
      ];
      const catalogSources = new Map([
        ['cue-smoke-track-0', {
          file: albumFile,
          physicalSourceKey: 'album-a',
          startFrame: 0,
          endFrame: 75,
          durationSec: 1
        }],
        ['cue-smoke-track-1', {
          file: albumFile,
          physicalSourceKey: 'album-a',
          startFrame: 75,
          endFrame: 150,
          durationSec: 1
        }],
        ['cue-smoke-track-2', {
          file: albumFile,
          physicalSourceKey: 'album-a',
          startFrame: 150,
          endFrame: null,
          durationSec: 2
        }]
      ]);
      const operationListeners = new Set();
      const catalogService = {
        async start() {
          return {
            kind: 'started',
            operationId: 'cue-smoke-operation',
            provisionalEntry: catalogEntries[0]
          };
        },
        async status() {
          return { state: 'running' };
        },
        subscribeOperation(_operationId, listener) {
          operationListeners.add(listener);
          return () => operationListeners.delete(listener);
        },
        async cancel() {
          return { kind: 'cancelRequested' };
        },
        async readSequencePage({ ordinal, limit }) {
          return { items: catalogEntries.slice(ordinal, ordinal + limit) };
        },
        async resolveSequenceEntrySource({ trackUid }) {
          return catalogSources.get(trackUid);
        }
      };
      const catalogBridge = new CatalogPlaybackBridge({
        uiManager: {
          audioPlayer: contiguous.audioPlayer,
          showTransientMessage() {}
        },
        service: catalogService
      });
      const startReceipt = await catalogBridge.start({
        operationKind: 'play',
        selectionDescriptor: { mode: 'all', contextToken: 'cue-smoke', exclusions: [] }
      });
      await waitFor(
        () => contiguous.state.currentTrack?.entryInstanceId === 'cue-smoke-entry-0' &&
          contiguous.state.isPlaying === true &&
          contiguous.state.isTransitioning === false &&
          contiguous.manager.activeRegion?.metadataValidated === true,
        'catalog provisional CUE activation'
      );
      await contiguous.manager.activeRegion.transportPlanPromise;
      const firstElement = contiguous.audioPlayer.audioElement;
      check(firstElement instanceof HTMLMediaElement, 'The CUE source is not an HTMLMediaElement.');
      let srcMutations = 0;
      const srcObserver = new MutationObserver(records => {
        srcMutations += records.filter(record => record.attributeName === 'src').length;
      });
      srcObserver.observe(firstElement, { attributes: true, attributeFilter: ['src'] });
      const physicalSamples = [];
      firstElement.addEventListener('timeupdate', () => {
        physicalSamples.push(firstElement.currentTime);
      });

      const lifecycleBaseline = {
        loadCalls,
        objectUrlCreates,
        objectUrlRevokes,
        srcMutations,
        src: firstElement.src,
        powerAutomatic: contiguous.powerCalls.automatic,
        powerUser: contiguous.powerCalls.user
      };
      ownedObjectUrls.add(contiguous.manager.currentObjectURL);
      const terminal = {
        state: 'succeeded',
        result: {
          operationKind: 'play',
          destination: 'replace',
          sequenceId: 'cue-smoke-published',
          itemCount: catalogEntries.length,
          firstOrdinal: 0,
          firstEntry: catalogEntries[0]
        }
      };
      for (const listener of [...operationListeners]) {
        listener({
          kind: 'terminal',
          operationId: 'cue-smoke-operation',
          result: terminal
        });
      }
      await waitFor(
        () => contiguous.playbackManager.catalogSequence?.sequenceId === 'cue-smoke-published' &&
          contiguous.manager.activeRegion?.transportPlanPending === false,
        'catalog CUE sequence publish'
      );
      const publishMetrics = {
        sameElement: contiguous.audioPlayer.audioElement === firstElement,
        sameSrc: firstElement.src === lifecycleBaseline.src,
        loadCalls: loadCalls - lifecycleBaseline.loadCalls,
        objectUrlCreates: objectUrlCreates - lifecycleBaseline.objectUrlCreates,
        objectUrlRevokes: objectUrlRevokes - lifecycleBaseline.objectUrlRevokes,
        srcMutations: srcMutations - lifecycleBaseline.srcMutations,
        powerAutomaticCalls: contiguous.powerCalls.automatic - lifecycleBaseline.powerAutomatic,
        powerUserCalls: contiguous.powerCalls.user - lifecycleBaseline.powerUser,
        planReady: contiguous.manager.activeRegion.transportPlan !== null
      };
      firstElement.playbackRate = 2;
      await waitFor(() => contiguous.state.currentTrackIndex === 2, 'three contiguous CUE regions');
      await contiguous.manager.pause();

      const boundaryMetrics = {
        sameElement: contiguous.audioPlayer.audioElement === firstElement,
        sameSrc: firstElement.src === lifecycleBaseline.src,
        loadCalls: loadCalls - lifecycleBaseline.loadCalls,
        objectUrlCreates: objectUrlCreates - lifecycleBaseline.objectUrlCreates,
        objectUrlRevokes: objectUrlRevokes - lifecycleBaseline.objectUrlRevokes,
        srcMutations: srcMutations - lifecycleBaseline.srcMutations,
        powerAutomaticCalls: contiguous.powerCalls.automatic - lifecycleBaseline.powerAutomatic,
        powerUserCalls: contiguous.powerCalls.user - lifecycleBaseline.powerUser,
        transitions: contiguous.transitionSnapshots.slice(),
        physicalSamples: physicalSamples.slice(),
        currentTime: firstElement.currentTime,
        index: contiguous.state.currentTrackIndex
      };
      const catalogLifecycleMetrics = {
        receiptKind: startReceipt.kind,
        provisionalEntryInstanceId: 'cue-smoke-entry-0',
        publishedSequenceId: contiguous.playbackManager.catalogSequence.sequenceId,
        publish: publishMetrics
      };
      catalogBridge.close();

      await contiguous.manager.seek(0.25);
      const seekMetrics = {
        physicalTime: contiguous.audioPlayer.audioElement.currentTime,
        logicalTime: contiguous.state.currentTrackPosition,
        paused: contiguous.audioPlayer.audioElement.paused && contiguous.state.isPaused
      };
      const graphPosition = contiguous.manager.getPlaybackPositionForGraphRebind(
        contiguous.stateManager?.getStateSnapshot?.() ?? contiguous.state
      );
      await contiguous.manager.resumePlaybackAudioContext(true);

      const oldContext = contiguous.audioPlayer.audioContext;
      const rebuiltContext = new AudioContext();
      openContexts.push(rebuiltContext);
      contiguous.installGraph(rebuiltContext);
      const graphBaseline = { loadCalls, objectUrlCreates, objectUrlRevokes };
      await contiguous.manager.handleAudioGraphRebuilt();
      ownedObjectUrls.add(contiguous.manager.currentObjectURL);
      const rebuiltElement = contiguous.audioPlayer.audioElement;
      const graphMetrics = {
        replacedElement: rebuiltElement !== firstElement && rebuiltElement instanceof HTMLMediaElement,
        loadCalls: loadCalls - graphBaseline.loadCalls,
        objectUrlCreates: objectUrlCreates - graphBaseline.objectUrlCreates,
        objectUrlRevokes: objectUrlRevokes - graphBaseline.objectUrlRevokes,
        physicalTime: rebuiltElement.currentTime,
        logicalTime: contiguous.state.currentTrackPosition,
        paused: rebuiltElement.paused && contiguous.state.isPaused,
        capturedLogicalPosition: graphPosition
      };
      await oldContext.close();
      srcObserver.disconnect();

      const sourceA = createWavFile('source-a.wav', 1.5, 330);
      const sourceB = createWavFile('source-b.wav', 1.5, 440);
      const different = createHarness([
        track('Source A', sourceA, 'source-a', 0, 75, 1),
        track('Source B', sourceB, 'source-b', 0, null, 1.5)
      ]);
      const differentStart = { loadCalls, objectUrlCreates, objectUrlRevokes };
      let normalSwitches = 0;
      const transitionToNextTrack = different.manager.transitionToNextTrack.bind(different.manager);
      different.manager.transitionToNextTrack = async (...args) => {
        normalSwitches += 1;
        return transitionToNextTrack(...args);
      };
      const differentFirstElement = different.audioPlayer.audioElement;
      check(different.manager.setupAudioElement(different.entries[0], 0), 'Different-source setup failed.');
      check(await waitForMetadata(different.manager.activeRegion), 'Different-source metadata validation failed.');
      await different.manager.activeRegion.transportPlanPromise;
      const differentFirstSrc = different.audioPlayer.audioElement.src;
      ownedObjectUrls.add(different.manager.currentObjectURL);
      check(await different.manager.play(true, false), 'Different-source playback failed.');
      different.audioPlayer.audioElement.playbackRate = 4;
      await waitFor(
        () => different.state.currentTrackIndex === 1 &&
          different.state.isTransitioning === false && normalSwitches === 1,
        'different-source CUE switch'
      );
      ownedObjectUrls.add(different.manager.currentObjectURL);
      const differentMetrics = {
        actualHtmlMediaElement: different.audioPlayer.audioElement instanceof HTMLMediaElement,
        normalSwitches,
        loadCalls: loadCalls - differentStart.loadCalls,
        objectUrlCreates: objectUrlCreates - differentStart.objectUrlCreates,
        objectUrlRevokes: objectUrlRevokes - differentStart.objectUrlRevokes,
        srcChanged: different.audioPlayer.audioElement.src !== differentFirstSrc,
        elementReplaced: different.audioPlayer.audioElement !== differentFirstElement,
        index: different.state.currentTrackIndex,
        powerAutomaticCalls: different.powerCalls.automatic
      };
      different.audioPlayer.audioElement.pause();

      const delayedSameFile = createWavFile('delayed-same.wav', 2, 550);
      const delayedSameMetrics = await exerciseDelayedBoundaryPlan([
        track('Delayed Same A', delayedSameFile, 'delayed-same', 0, 75, 1),
        track('Delayed Same B', delayedSameFile, 'delayed-same', 75, null, 1)
      ]);
      const delayedDifferentMetrics = await exerciseDelayedBoundaryPlan([
        track('Delayed Different A', createWavFile('delayed-a.wav', 1, 660), 'delayed-a', 0, 75, 1),
        track('Delayed Different B', createWavFile('delayed-b.wav', 1, 770), 'delayed-b', 0, null, 1)
      ]);

      return {
        boundaryMetrics,
        catalogLifecycleMetrics,
        delayedDifferentMetrics,
        delayedSameMetrics,
        differentMetrics,
        graphMetrics,
        powerMetrics: contiguous.powerCalls,
        seekMetrics
      };
    } finally {
      HTMLMediaElement.prototype.load = originalLoad;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      for (const objectUrl of ownedObjectUrls) {
        if (objectUrl) originalRevokeObjectURL(objectUrl);
      }
      await Promise.all(openContexts.map(context => context.close().catch(() => {})));
    }
  });
}

export async function runCueRegionBrowserSmoke({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  try {
    await page.goto(`${baseURL}${CUE_REGION_SMOKE_FIXTURE_PATH}`, { waitUntil: 'load' });
    const result = await runBrowserScenario(page);

    assert.equal(result.boundaryMetrics.index, 2);
    assert.equal(result.boundaryMetrics.sameElement, true);
    assert.equal(result.boundaryMetrics.sameSrc, true);
    assert.equal(result.boundaryMetrics.loadCalls, 0);
    assert.equal(result.boundaryMetrics.objectUrlCreates, 0);
    assert.equal(result.boundaryMetrics.objectUrlRevokes, 0);
    assert.equal(result.boundaryMetrics.srcMutations, 0);
    assert.deepEqual(result.boundaryMetrics.transitions.map(item => item.index), [1, 2]);
    assert.ok(result.boundaryMetrics.transitions[0].currentTime >= 0.98);
    assert.ok(result.boundaryMetrics.transitions[1].currentTime >= 1.98);
    assert.ok(result.boundaryMetrics.transitions.every(
      (item, index, items) => index === 0 || item.currentTime >= items[index - 1].currentTime
    ));
    assert.ok(result.boundaryMetrics.physicalSamples.every(
      (time, index, samples) => index === 0 || time + 0.05 >= samples[index - 1]
    ));

    assert.equal(result.catalogLifecycleMetrics.receiptKind, 'started');
    assert.equal(result.catalogLifecycleMetrics.provisionalEntryInstanceId, 'cue-smoke-entry-0');
    assert.equal(result.catalogLifecycleMetrics.publishedSequenceId, 'cue-smoke-published');
    assert.equal(result.catalogLifecycleMetrics.publish.sameElement, true);
    assert.equal(result.catalogLifecycleMetrics.publish.sameSrc, true);
    assert.equal(result.catalogLifecycleMetrics.publish.loadCalls, 0);
    assert.equal(result.catalogLifecycleMetrics.publish.objectUrlCreates, 0);
    assert.equal(result.catalogLifecycleMetrics.publish.objectUrlRevokes, 0);
    assert.equal(result.catalogLifecycleMetrics.publish.srcMutations, 0);
    assert.equal(result.catalogLifecycleMetrics.publish.powerAutomaticCalls, 0);
    assert.equal(result.catalogLifecycleMetrics.publish.powerUserCalls, 0);
    assert.equal(result.catalogLifecycleMetrics.publish.planReady, true);
    assert.equal(result.boundaryMetrics.powerAutomaticCalls, 0);
    assert.equal(result.boundaryMetrics.powerUserCalls, 0);

    assert.equal(result.seekMetrics.paused, true);
    assert.ok(Math.abs(result.seekMetrics.physicalTime - 2.25) < 0.05);
    assert.ok(Math.abs(result.seekMetrics.logicalTime - 0.25) < 0.01);
    assert.equal(result.powerMetrics.automatic, 0);
    assert.equal(result.powerMetrics.user, 2);

    assert.equal(result.graphMetrics.replacedElement, true);
    assert.equal(result.graphMetrics.loadCalls, 1);
    assert.equal(result.graphMetrics.objectUrlCreates, 1);
    assert.equal(result.graphMetrics.objectUrlRevokes, 1);
    assert.ok(Math.abs(result.graphMetrics.capturedLogicalPosition - 0.25) < 0.05);
    assert.ok(Math.abs(result.graphMetrics.physicalTime - 2.25) < 0.05);
    assert.ok(Math.abs(result.graphMetrics.logicalTime - 0.25) < 0.05);
    assert.equal(result.graphMetrics.paused, true);

    assert.equal(result.differentMetrics.actualHtmlMediaElement, true);
    assert.equal(result.differentMetrics.normalSwitches, 1);
    assert.equal(result.differentMetrics.loadCalls, 2);
    assert.equal(result.differentMetrics.objectUrlCreates, 2);
    assert.equal(result.differentMetrics.objectUrlRevokes, 1);
    assert.equal(result.differentMetrics.srcChanged, true);
    assert.equal(result.differentMetrics.elementReplaced, true);
    assert.equal(result.differentMetrics.index, 1);
    assert.equal(result.differentMetrics.powerAutomaticCalls, 2);

    for (const metrics of [result.delayedSameMetrics, result.delayedDifferentMetrics]) {
      assert.equal(metrics.immediate.synchronous, true);
      assert.equal(metrics.immediate.boundaryCommitted, true);
      assert.ok(Math.abs(metrics.immediate.currentTime - 1) < 0.01);
      assert.equal(metrics.immediate.logicalPosition, 1);
      assert.equal(metrics.immediate.paused, true);
      assert.equal(metrics.immediate.pauseCount, 1);
      assert.equal(metrics.immediate.timerCleared, true);
      assert.equal(metrics.immediate.normalTransportCount, 1);
      assert.equal(metrics.immediate.plannedCommitCount, 0);
      assert.equal(metrics.immediate.plannedTransitionCount, 0);
      assert.equal(metrics.immediate.currentCheckCount, 0);
      assert.equal(metrics.late.transportPlan, null);
      assert.equal(metrics.late.transportPlanPending, false);
      assert.equal(metrics.late.normalTransportCount, 1);
      assert.equal(metrics.late.plannedCommitCount, 0);
      assert.equal(metrics.late.plannedTransitionCount, 0);
      assert.equal(metrics.late.currentCheckCount, 0);
    }
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
}

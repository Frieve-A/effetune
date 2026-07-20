class IRReverbPlugin extends PluginBase {
    constructor() {
        super('IR Reverb', 'Convolution reverb using an imported impulse response');

        this.ir = '';
        this._irFileLabel = '';
        this.cm = 'auto';
        this.lt = '128';
        this.cr = 'auto';
        this.dw = 0;
        this.dl = 0;
        this.pd = 0;
        this.dc = true;
        this.co = 0;
        this.dt = 100;
        this.tr = 100;

        this.temporalCapability = 'reset-on-resume';
        this._generation = 0;
        this._preparationTimer = null;
        this._runtimePromise = null;
        this._workerClient = null;
        this._pcm = null;
        this._hostPreparedByRate = new Map();
        this._prepared = null;
        this._assetResident = false;
        this._assetGeneration = null;
        this._assetRejected = false;
        this._assetClearPending = false;
        this._pendingAdmissionRejectionGeneration = null;
        this._committedAssetSnapshot = null;
        this._pendingAssetCandidate = null;
        this._replacementBaseline = null;
        this._residentAssetRevisionCandidate = null;
        this._residentAssetState = 0;
        this._requestedAssetDefinition = null;
        this._assetRevisionSnapshots = new Map();
        this._assetControlRows = new Map();
        this._pendingReadyNotice = null;
        this._statusElement = null;
        this._metadataElement = null;
        this._graphCanvas = null;
        this._libraryServicePromise = null;
        this._assetResolutionPromise = null;
        this._assetResolutionGeneration = null;
        this._missingIr = false;
        this._sampleRate = this._getEngineSampleRate();
        this._outputChannelCount = this._getEngineChannelCount();
        this.registerProcessor(`
            const dryLevel = Number.isFinite(parameters.dl) ? parameters.dl : 0;
            const dryGain = dryLevel <= -96 ? 0 : Math.pow(10, dryLevel / 20);
            if (dryGain === 1) return data;
            if (dryGain === 0) {
                data.fill(0);
                return data;
            }
            for (let index = 0; index < data.length; index++) data[index] *= dryGain;
            return data;
        `);
    }

    _t(key, fallback, params = {}) {
        const translated = globalThis.window?.uiManager?.t?.(key, params);
        if (translated && translated !== key) return translated;
        return Object.entries(params).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            fallback
        );
    }

    _configMessage(message) {
        const keyByMessage = {
            'The current audio sample rate is unavailable.': 'irReverb.error.sampleRateUnavailable',
            'This impulse response has an unsupported channel count.': 'irReverb.error.unsupportedChannels',
            'The selected audio channels are not available.': 'irReverb.error.selectedChannelsUnavailable',
            'Choose a supported channel mode.': 'irReverb.error.unsupportedChannelMode',
            'Choose a supported latency setting.': 'irReverb.error.unsupportedLatency',
            'Choose a supported convolution rate.': 'irReverb.error.unsupportedConvolutionRate',
            'Quarter rate is available at sample rates of 176.4 kHz or higher.': 'irReverb.error.quarterRateUnavailable',
            'True Stereo requires a four-channel IR and a stereo channel selection.': 'irReverb.error.trueStereoRequirements',
            'Independent mode requires one IR channel for each selected audio channel.': 'irReverb.error.independentRequirements',
            'Matrix mode could not create a valid channel route.': 'irReverb.error.matrixRoute'
        };
        const key = keyByMessage[message];
        return key ? this._t(key, message) : this._t('irReverb.error.unsupportedConfiguration',
            'The selected impulse-response configuration is not supported.');
    }

    process(context, data, parameters, time) {
        const dryLevel = Number.isFinite(parameters.dl) ? parameters.dl : 0;
        const dryGain = dryLevel <= -96 ? 0 : Math.pow(10, dryLevel / 20);
        if (dryGain === 1) return data;
        if (dryGain === 0) {
            data.fill(0);
            return data;
        }
        for (let index = 0; index < data.length; index++) data[index] *= dryGain;
        return data;
    }

    getParameters(options = {}) {
        const optionSampleRate = options?.sampleRate;
        const optionOutputChannels = options?.outputChannelCount;
        const nextSampleRate = Number.isFinite(optionSampleRate) && optionSampleRate > 0
            ? optionSampleRate
            : this._sampleRate;
        const nextOutputChannels = Number.isInteger(optionOutputChannels) &&
            optionOutputChannels >= 1 && optionOutputChannels <= 8
            ? optionOutputChannels
            : this._outputChannelCount;
        const outputFormatChanged = options?.commitSampleRate &&
            (nextSampleRate !== this._sampleRate || nextOutputChannels !== this._outputChannelCount);
        if (outputFormatChanged) {
            const requested = this._currentRequestedAssetDefinition();
            this._sampleRate = nextSampleRate;
            this._outputChannelCount = nextOutputChannels;
            if (requested) {
                this._restartRequestedAssetForOutputFormat(requested);
            } else if (this._pcm && this.ir && !this._missingIr) {
                this._cancelPreparationTimer();
                this._clearPreparedAsset();
                const generation = ++this._generation;
                this._hostPreparedByRate.clear();
                this._queuePreparation('host', 0, generation);
            }
        }
        return {
            ...super.getParameters(),
            ir: this.ir,
            cm: this.cm,
            lt: this.lt,
            cr: this.cr,
            dw: this.dw,
            dl: this.dl,
            pd: this.pd,
            dc: this.dc,
            co: this.co,
            dt: this.dt,
            tr: this.tr
        };
    }

    get externalAssetInfo() {
        const requested = this._currentRequestedAssetDefinition();
        const pendingCandidate = this._pendingAssetCandidate;
        const pending = Boolean(this._assetResolutionPromise &&
            this._assetResolutionGeneration === this._generation);
        const ir = this.ir;
        const fileLabel = this._irFileLabel;
        if (!ir) {
            const protectedIds = this._protectedExternalAssetIds(requested);
            return protectedIds.length || pending
                ? { pending, kind: 'IR', ids: [], names: [], protectedIds }
                : null;
        }
        return {
            missing: this._missingIr,
            pending,
            ids: [ir],
            kind: 'IR',
            names: [fileLabel || `IR ${ir.slice(0, 8)}`],
            assetSignature: requested?.externalAssetSignature ||
                pendingCandidate?.snapshot?.externalAssetSignature ||
                this._committedAssetSnapshot?.externalAssetSignature || this._externalAssetSignature(),
            protectedIds: this._protectedExternalAssetIds(requested)
        };
    }

    get offlineDspAssetRequired() {
        return Boolean(this.ir || this._currentRequestedAssetDefinition()?.ir ||
            this.externalAssetInfo?.pending);
    }

    setSerializedParameters(params) {
        const clearedPluginId = this.id;
        const nextIr = typeof params?.ir === 'string' && /^[a-f0-9]{24}$/.test(params.ir)
            ? params.ir
            : '';
        const preserveResident = Boolean(nextIr && this._assetResident && this._prepared);
        this._replacementBaseline = preserveResident ? this._residentBaseline() : null;
        if (nextIr !== this.ir) this._irFileLabel = '';
        ++this._generation;
        this._cancelPreparationTimer();
        if (!preserveResident) this._clearIrAsset(false);
        super.setSerializedParameters(params);
        this._cancelPreparationTimer();
        if (this.id !== clearedPluginId) this._assetClearPending = false;
        this._trackAssetResolution(this._resolveSerializedIr(true));
    }

    setParameters(params = {}) {
        const requested = this._currentRequestedAssetDefinition();
        const previous = this.getParameters();
        super._setValidatedParameters(params);
        const channelModes = ['auto', 'mono', 'indep', 'true', 'multi'];
        const latencyModes = ['0', '128', '256', '512', '1024'];
        const rateModes = ['auto', 'full', 'half', 'quarter'];
        if (typeof params.ir === 'string') this.ir = /^[a-f0-9]{24}$/.test(params.ir) ? params.ir : '';
        if (channelModes.includes(params.cm)) this.cm = params.cm;
        if (latencyModes.includes(String(params.lt))) this.lt = String(params.lt);
        if (rateModes.includes(params.cr)) this.cr = params.cr;
        if (params.dw !== undefined) this.dw = this.parseFiniteNumber(params.dw, -96, 12, this.dw);
        if (params.dl !== undefined) this.dl = this.parseFiniteNumber(params.dl, -96, 12, this.dl);
        if (params.pd !== undefined) this.pd = this.parseFiniteNumber(params.pd, 0, 500, this.pd);
        if (params.dc !== undefined) this.dc = Boolean(params.dc);
        if (params.co !== undefined) this.co = this.parseFiniteNumber(params.co, -20, 50, this.co);
        if (params.dt !== undefined) this.dt = this.parseFiniteNumber(params.dt, 10, 400, this.dt);
        if (params.tr !== undefined) this.tr = this.parseFiniteNumber(params.tr, 1, 100, this.tr);
        const requestedControlNames = ['cm', 'lt', 'cr', 'channel', 'dc', 'co', 'dt', 'tr'];
        const requestedControlsTouched = requested && requestedControlNames.some(name =>
            Object.hasOwn(params, name) && params[name] !== undefined);
        if (requestedControlsTouched) {
            const residentControls = {
                cm: previous.cm,
                lt: previous.lt,
                cr: previous.cr,
                channel: previous.channel ?? null,
                dc: previous.dc,
                co: previous.co,
                dt: previous.dt,
                tr: previous.tr
            };
            const nextControls = { ...requested.controls };
            for (const name of requestedControlNames) {
                if (Object.hasOwn(params, name) && params[name] !== undefined) {
                    nextControls[name] = this[name];
                }
            }
            this._updateRequestedAssetControls(requested, nextControls);
            this._applyAssetControls(residentControls);
            this._updatePowerGainBound();
            this.updateParameters();
            if (previous.pd !== this.pd) this._drawEdcGraph();
            return;
        }
        const hostPreparationChanged = previous.dc !== this.dc || previous.co !== this.co ||
            previous.dt !== this.dt || previous.tr !== this.tr || previous.cr !== this.cr;
        const kernelRestageChanged = previous.lt !== this.lt || previous.cm !== this.cm;
        if (hostPreparationChanged) this._hostPreparedByRate.clear();
        this._updatePowerGainBound();
        this.updateParameters();
        if (this._pcm && (hostPreparationChanged || kernelRestageChanged)) {
            this._queuePreparation(hostPreparationChanged ? 'host' : 'restage', hostPreparationChanged ? 150 : 0);
        }
        if (previous.pd !== this.pd) this._drawEdcGraph();
    }

    async importFile(file) {
        return this.importFiles(file ? [file] : []);
    }

    importFiles(files) {
        const selected = Array.from(files || []);
        if (!selected.length) {
            this._setStatus(this._t('irReverb.error.chooseFiles',
                'Choose one or more impulse-response audio files.'), 'error');
            return Promise.resolve(false);
        }
        const generation = ++this._generation;
        return this._trackAssetResolution(this._importFiles(selected, generation), generation);
    }

    async _importFiles(selected, generation) {
        this._cancelPreparationTimer();
        this._setStatus(this._t('irReverb.status.preparing', 'Preparing the impulse response…'), 'preparing');
        try {
            if (selected.length === 2) {
                const runtime = await this._getRuntime();
                if (generation !== this._generation) return false;
                const naming = selected.map(file => runtime.parseTrueStereoSide(file?.name));
                if (naming.some(value => !value) || naming[0].base !== naming[1].base ||
                    naming[0].side === naming[1].side) {
                    this._setStatus(this._t('irReverb.error.pairNames',
                        'The two files must have matching names ending in L/R or Left/Right.'), 'error');
                    return false;
                }
            }
            const expectedId = this._missingIr ? this.ir : '';
            const service = await this._getLibraryService();
            const result = await service.importFiles(selected, {
                strictPair: selected.length === 2,
                isCurrent: () => generation === this._generation
            });
            if (generation !== this._generation) return false;
            const entry = expectedId
                ? result.imported.find(candidate => candidate.irId === expectedId)
                : result.imported[0];
            const fileTooLarge = result.failureCodes?.includes('file-too-large');
            if (!entry) {
                let message;
                if (fileTooLarge) {
                    message = this._t('irLibrary.error.fileTooLarge',
                        'The selected impulse response is too large. Choose a shorter impulse response and try again.');
                } else if (expectedId) {
                    message = this._t('irReverb.error.idMismatch',
                        'The imported file does not match the missing impulse response. Choose it as a substitute from the library if desired.');
                } else {
                    message = this._t('irReverb.error.noSupportedImports',
                        'No supported impulse responses were imported.');
                }
                this._setStatus(message, 'error');
                return false;
            }
            let readyNotice = null;
            if (result.failedCount || result.unsupportedCount) {
                const partial = this._t('irReverb.status.partialImport',
                    '{count} imported; some files were skipped.', { count: result.imported.length });
                const detail = fileTooLarge
                    ? ` ${this._t('irLibrary.error.fileTooLarge',
                        'The selected impulse response is too large. Choose a shorter impulse response and try again.')}`
                    : '';
                readyNotice = `${partial}${detail}`;
            }
            return await this.loadLibraryEntry(entry, generation, {
                propagateFailure: true,
                readyNotice
            });
        } catch (error) {
            if (generation !== this._generation) return false;
            console.error('IR Reverb import failed:', error);
            const pairMessages = {
                'Choose one left and one right stereo impulse-response file.': ['irReverb.error.choosePair', 'Choose one left and one right stereo impulse-response file.'],
                'The two files must have matching names ending in L/R or Left/Right.': ['irReverb.error.pairNames', 'The two files must have matching names ending in L/R or Left/Right.'],
                'Each true-stereo pair file must contain exactly two audio channels.': ['irReverb.error.pairChannels', 'Each true-stereo pair file must contain exactly two audio channels.'],
                'The left and right impulse-response files must use the same sample rate.': ['irReverb.error.pairSampleRate', 'The left and right impulse-response files must use the same sample rate.']
            };
            const pairCopy = pairMessages[error?.message];
            const pairMessage = pairCopy ? this._t(pairCopy[0], pairCopy[1]) : null;
            this._setStatus(pairMessage ||
                this._t('irReverb.error.importAudio',
                    'This audio file could not be imported. Try another WAV, FLAC, or AIFF file.'), 'error');
            return false;
        }
    }

    _queuePreparation(kind, delayMs, generation = ++this._generation) {
        this._cancelPreparationTimer();
        if (delayMs > 0) {
            this._preparationTimer = setTimeout(() => {
                this._preparationTimer = null;
                if (kind === 'restage') this._restagePrepared(generation);
                else this._prepareAndStage(generation);
            }, delayMs);
            return;
        }
        Promise.resolve().then(() => kind === 'restage'
            ? this._restagePrepared(generation)
            : this._prepareAndStage(generation));
    }

    _cancelPreparationTimer() {
        if (this._preparationTimer !== null) clearTimeout(this._preparationTimer);
        this._preparationTimer = null;
    }

    async _prepareAndStage(generation) {
        if (!this._pcm || generation !== this._generation) return false;
        const requested = this._requestedAssetDefinitionFor(generation);
        if (!requested.pcm) return false;
        const controlRevision = requested.controlRevision || 0;
        const controlsChanged = () => requested.controlRevision !== controlRevision;
        const restartForControls = () => requested.controlRestartPromise ||
            this._prepareAndStage(generation);
        this._setStatus(this._t('irReverb.status.preparing', 'Preparing the impulse response…'), 'preparing');
        try {
            const runtime = await this._getRuntime();
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            const engineSampleRate = requested.sampleRate;
            const engineChannels = requested.outputChannelCount;
            const config = runtime.resolveIrProcessingConfig({
                sampleRate: engineSampleRate,
                channelCount: requested.pcm.channels.length,
                engineChannels,
                channel: requested.controls.channel,
                topologyHint: requested.pcm.topologyHint,
                channelMode: requested.controls.cm,
                latency: requested.controls.lt,
                convolutionRate: requested.controls.cr
            });
            if (!config.valid) {
                if (!this._restoreReplacementBaseline()) this._clearPreparedAsset();
                this._setStatus(this._configMessage(config.message), 'error');
                return false;
            }

            let sourcePcm = requested.pcm;
            if (requested.ir) {
                const service = await this._getLibraryService();
                sourcePcm = await service.resolveDecodedPcm(requested.ir, config.sampleRate, {
                    decode: bytes => this._decodeAudioData(bytes),
                    resample: (pcm, rate) => this._resamplePcm(pcm, rate),
                    isCurrent: () => generation === this._generation
                });
                if (generation !== this._generation) return false;
                if (controlsChanged()) return restartForControls();
                if (!sourcePcm) {
                    this._commitMissingRequestedAsset(requested);
                    return false;
                }
                requested.pcm = sourcePcm;
            }
            const resampled = await this._resamplePcm(sourcePcm, config.sampleRate);
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            const workerClient = await this._getWorkerClient(runtime);
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            const hostPrepared = await this._prepareHostPcm(
                workerClient,
                resampled,
                config,
                requested.controls
            );
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            requested.hostPreparedByRate.set(this._hostPreparationKey(config), hostPrepared);
            if (requested.ir) {
                const analysis = hostPrepared.analysis;
                this._getLibraryService().then(service => service.store.updateAnalysis(requested.ir, {
                    onsetFrame: analysis.onsetFrame,
                    rt60: analysis.rt60Seconds,
                    peakDb: analysis.peakDb,
                    envelope: analysis.envelope,
                    edc: analysis.edcDb
                })).catch(error => console.error('IR analysis update failed:', error));
            }
            return await this._emitAndStage(
                generation,
                runtime,
                config,
                hostPrepared,
                requested,
                controlRevision
            );
        } catch (error) {
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            console.error('IR Reverb preparation failed:', error);
            this._settleRequestedAssetFailure(requested);
            this._setStatus(this._t('irReverb.error.prepare',
                'The impulse response could not be prepared. Try a shorter audio file.'), 'error');
            if (requested.propagateFailure) throw error;
            return false;
        }
    }

    async _restagePrepared(generation) {
        if (!this._pcm || generation !== this._generation) return false;
        const requested = this._requestedAssetDefinitionFor(generation);
        if (!requested.pcm) return false;
        const controlRevision = requested.controlRevision || 0;
        const controlsChanged = () => requested.controlRevision !== controlRevision;
        const restartForControls = () => requested.controlRestartPromise ||
            this._prepareAndStage(generation);
        try {
            const runtime = await this._getRuntime();
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            const config = runtime.resolveIrProcessingConfig({
                sampleRate: requested.sampleRate,
                channelCount: requested.pcm.channels.length,
                engineChannels: requested.outputChannelCount,
                channel: requested.controls.channel,
                topologyHint: requested.pcm.topologyHint,
                channelMode: requested.controls.cm,
                latency: requested.controls.lt,
                convolutionRate: requested.controls.cr
            });
            if (!config.valid) {
                this._clearPreparedAsset();
                this._setStatus(this._configMessage(config.message), 'error');
                return false;
            }
            const hostPrepared = requested.hostPreparedByRate.get(this._hostPreparationKey(config));
            if (!hostPrepared) return await this._prepareAndStage(generation);
            return await this._emitAndStage(
                generation,
                runtime,
                config,
                hostPrepared,
                requested,
                controlRevision
            );
        } catch (error) {
            if (generation !== this._generation) return false;
            if (controlsChanged()) return restartForControls();
            console.error('IR Reverb re-staging failed:', error);
            this._settleRequestedAssetFailure(requested);
            this._setStatus(this._t('irReverb.error.reload',
                'The impulse response could not be reloaded. Try importing it again.'), 'error');
            if (requested.propagateFailure) throw error;
            return false;
        }
    }

    _prepareHostPcm(workerClient, pcm, config, controls = this._captureAssetControls()) {
        return workerClient.prepare({
            channels: pcm.channels,
            sampleRate: config.sampleRate,
            options: {
                topology: config.topology,
                paths: config.paths,
                directCut: controls.dc,
                cutOffsetMs: controls.co,
                decayPercent: controls.dt,
                trimPercent: controls.tr,
                maxFrames: pcm.channels[0].length,
                analysisPoints: 1600
            }
        });
    }

    async _createPreparedAsset(runtime, workerClient, config, hostPrepared) {
        const maximumFrames = runtime.maximumIrFramesForKernel({
            sourceFrames: hostPrepared.frames,
            assetChannels: config.assetChannels,
            topology: config.topology,
            processingChannels: config.processingChannels,
            headBlock: config.headBlock,
            pathCount: config.pathCount,
            inputCount: config.inputCount
        });
        const prepared = await workerClient.emit({
            channels: hostPrepared.channels,
            sampleRate: hostPrepared.sampleRate,
            analysis: hostPrepared.analysis,
            options: {
                topology: config.topology,
                assetChannels: config.assetChannels,
                paths: config.paths,
                maxFrames: maximumFrames,
                analysisPoints: 1600
            }
        });
        const footprintBytes = runtime.estimateIrKernelCommitFootprint({
            frames: prepared.frames,
            assetChannels: prepared.asset.channels,
            topology: config.topology,
            processingChannels: config.processingChannels,
            headBlock: config.headBlock,
            pathCount: config.pathCount,
            inputCount: config.inputCount
        });
        return {
            prepared,
            maximumFrames,
            footprintBytes,
            descriptor: {
                payload: prepared.payload,
                formatTag: prepared.asset.formatTag,
                headBlock: config.headBlock,
                rateDivider: config.rateDivider,
                pathCount: config.pathCount,
                inputCount: config.inputCount,
                processingChannels: config.processingChannels,
                footprintBytes
            }
        };
    }

    async _emitAndStage(
        generation,
        runtime,
        config,
        hostPrepared,
        requested = null,
        controlRevision = requested?.controlRevision || 0
    ) {
        const workerClient = await this._getWorkerClient(runtime);
        if (generation !== this._generation) return false;
        if (requested && requested.controlRevision !== controlRevision) {
            return requested.controlRestartPromise || this._prepareAndStage(generation);
        }
        const result = await this._createPreparedAsset(runtime, workerClient, config, hostPrepared);
        if (generation !== this._generation) return false;
        if (requested && requested.controlRevision !== controlRevision) {
            return requested.controlRestartPromise || this._prepareAndStage(generation);
        }
        requested ||= this._requestedAssetDefinitionFor(generation);
        if (!this._applyRequestedAssetDefinition(requested)) return false;
        const replacementBaseline = this._replacementBaseline;
        const previousCandidate = this._pendingAssetCandidate;
        const baseline = replacementBaseline || previousCandidate?.snapshot ||
            this._committedAssetSnapshot || this._captureResidentSnapshot();
        const kind = replacementBaseline || previousCandidate?.kind === 'identity'
            ? 'identity'
            : 'restage';
        const operationRevision = this.setWasmAsset(runtime.IR_ASSET_SLOT, {
            ...result.descriptor,
            externalAssetSignature: requested.externalAssetSignature
        });
        this._assetClearPending = false;
        this._replacementBaseline = null;
        this._requestedAssetDefinition = null;
        this._assetResident = true;
        this._assetGeneration = generation;
        this._assetRejected = false;
        this._pendingAdmissionRejectionGeneration = null;
        const { analysis, frames, sampleRate } = result.prepared;
        this._prepared = {
            analysis,
            frames,
            sampleRate,
            config,
            footprintBytes: result.footprintBytes,
            maximumFrames: result.maximumFrames
        };
        const snapshot = this._captureResidentSnapshot();
        const candidate = { operationRevision, generation, kind, baseline, snapshot };
        this._pendingAssetCandidate = candidate;
        this._rememberAssetRevisionSnapshot(candidate);
        this._updatePowerGainBound();
        this.updateParameters();
        this._updateMetadata();
        this._drawEdcGraph();
        if (window.workletNode?.port) {
            this._setStatus(this._t('irReverb.status.loading', 'Loading {name}…', {
                name: this._irFileLabel || this._t('irReverb.name.theImpulseResponse', 'the impulse response')
            }), 'preparing');
        } else {
            this._setStatus(this._t('irReverb.error.wasmRequired',
                'IR Reverb requires WASM audio processing and will pass dry signal through.'), 'error');
        }
        return true;
    }

    async createOfflineDspState({ sampleRate, outputChannelCount }) {
        const generation = this._generation;
        const resolutionPromise = this._assetResolutionGeneration === generation
            ? this._assetResolutionPromise
            : null;
        if (resolutionPromise) await resolutionPromise;
        const irId = this.ir;
        const parameters = this.getParameters({ sampleRate });
        const isCurrent = () => generation === this._generation && irId === this.ir;
        if (!isCurrent() || !this._pcm || !irId || this._missingIr) {
            return { parameters, assets: new Map() };
        }
        const pcm = this._pcm;
        const runtime = await this._getRuntime();
        if (!isCurrent()) return { parameters, assets: new Map() };
        const config = runtime.resolveIrProcessingConfig({
            sampleRate,
            channelCount: pcm.channels.length,
            engineChannels: outputChannelCount,
            channel: this.channel,
            topologyHint: pcm.topologyHint,
            channelMode: this.cm,
            latency: this.lt,
            convolutionRate: this.cr
        });
        if (!config.valid) throw new Error(config.message);

        const service = await this._getLibraryService();
        if (!isCurrent()) return { parameters, assets: new Map() };
        const sourcePcm = await service.resolveDecodedPcm(irId, config.sampleRate, {
            decode: bytes => this._decodeAudioData(bytes),
            resample: (value, rate) => this._resamplePcm(value, rate),
            isCurrent
        });
        if (!isCurrent()) return { parameters, assets: new Map() };
        const resampled = await this._resamplePcm(sourcePcm || pcm, config.sampleRate);
        if (!isCurrent()) return { parameters, assets: new Map() };
        const workerClient = runtime.createIrPreparationWorkerClient();
        try {
            const hostPrepared = await this._prepareHostPcm(workerClient, resampled, config);
            if (!isCurrent()) return { parameters, assets: new Map() };
            const result = await this._createPreparedAsset(runtime, workerClient, config, hostPrepared);
            if (!isCurrent()) return { parameters, assets: new Map() };
            return {
                parameters,
                assets: new Map([[runtime.IR_ASSET_SLOT, {
                    ...result.descriptor,
                    externalAssetSignature: this._externalAssetSignature({
                        sampleRate,
                        outputChannelCount
                    })
                }]])
            };
        } finally {
            workerClient.close();
        }
    }

    async _getRuntime() {
        if (window.irReverbRuntime) return window.irReverbRuntime;
        if (!this._runtimePromise) {
            this._runtimePromise = Promise.all([
                import('../../js/ir-library/ir-plugin-contract.js'),
                import('../../js/ir-library/ir-preparation-worker-client.js'),
                import('../../js/ir-library/ir-true-stereo-pair.js')
            ]).then(([contract, worker, pairing]) => ({ ...contract, ...worker, ...pairing }));
        }
        return this._runtimePromise;
    }

    async _getLibraryService() {
        if (window.irLibraryService) return window.irLibraryService;
        if (!this._libraryServicePromise) {
            const pending = import('../../js/ir-library/service.js')
                .then(module => module.getDefaultIrLibraryService());
            const retryable = pending.catch(error => {
                if (this._libraryServicePromise === retryable) this._libraryServicePromise = null;
                throw error;
            });
            this._libraryServicePromise = retryable;
        }
        return this._libraryServicePromise;
    }

    _trackAssetResolution(promise, generation = this._generation) {
        const tracked = Promise.resolve(promise);
        if (generation === this._generation) {
            this._assetResolutionPromise = tracked;
            this._assetResolutionGeneration = generation;
            const clearIfCurrent = () => {
                if (this._assetResolutionPromise === tracked &&
                    this._assetResolutionGeneration === generation &&
                    generation === this._generation) {
                    this._assetResolutionPromise = null;
                    this._assetResolutionGeneration = null;
                    this._notifyWasmAssetSnapshotChange?.();
                }
            };
            tracked.then(clearIfCurrent, clearIfCurrent);
        }
        return tracked;
    }

    async _resolveSerializedIr(assetAlreadyCleared = false, options = {}) {
        const generation = Number.isSafeInteger(options.generation)
            ? options.generation
            : ++this._generation;
        this._cancelPreparationTimer();
        if (!assetAlreadyCleared) this._clearIrAsset(false);
        const ir = typeof options.ir === 'string' ? options.ir : this.ir;
        if (!/^[a-f0-9]{24}$/.test(ir)) {
            this._requestedAssetDefinition = null;
            return false;
        }
        const requested = this._beginRequestedAssetDefinition(generation, {
            ir,
            fileLabel: '',
            missingIr: false,
            pcm: null,
            hostPreparedByRate: new Map(),
            controls: options.controls,
            sampleRate: options.sampleRate,
            outputChannelCount: options.outputChannelCount,
            propagateFailure: options.propagateFailure,
            serializedResolution: true
        });
        this._setStatus(this._t('irReverb.status.preparing', 'Preparing the impulse response…'), 'preparing');
        try {
            const service = await this._getLibraryService();
            const entry = service.get(requested.ir);
            if (!entry || generation !== this._generation) {
                if (generation === this._generation) this._commitMissingRequestedAsset(requested);
                return false;
            }
            return this.loadLibraryEntry(entry, generation, {
                propagateFailure: requested.propagateFailure,
                controls: requested.controls,
                sampleRate: requested.sampleRate,
                outputChannelCount: requested.outputChannelCount
            });
        } catch (error) {
            console.error('IR library resolution failed:', error);
            if (generation === this._generation) {
                this._settleRequestedAssetFailure(requested);
                this._setStatus(this._t('irReverb.error.prepare',
                    'The impulse response could not be prepared. Try a shorter audio file.'), 'error');
            }
            return false;
        }
    }

    loadLibraryEntry(entry, generation = ++this._generation, options = {}) {
        return this._trackAssetResolution(
            this._loadLibraryEntry(entry, generation, options),
            generation
        );
    }

    async _loadLibraryEntry(entry, generation, {
        propagateFailure = false,
        readyNotice = null,
        controls = null,
        sampleRate,
        outputChannelCount
    } = {}) {
        if (!entry || generation !== this._generation) return false;
        this._replacementBaseline = this._residentBaseline();
        this._pendingReadyNotice = typeof readyNotice === 'string' && readyNotice
            ? readyNotice
            : null;
        const requested = this._beginRequestedAssetDefinition(generation, {
            ir: entry.irId,
            fileLabel: entry.fileLabel,
            missingIr: false,
            pcm: null,
            hostPreparedByRate: new Map(),
            propagateFailure,
            controls,
            sampleRate,
            outputChannelCount,
            libraryEntry: entry
        });
        this._setStatus(this._t('irReverb.status.preparing', 'Preparing the impulse response…'), 'preparing');
        let pcm;
        try {
            const runtime = await this._getRuntime();
            if (generation !== this._generation) return false;
            const config = runtime.resolveIrProcessingConfig({
                sampleRate: requested.sampleRate,
                channelCount: entry.channels || (entry.composition === 'pair' ? 4 : 1),
                engineChannels: requested.outputChannelCount,
                channel: requested.controls.channel,
                topologyHint: entry.composition === 'pair' ? 'true-stereo' : undefined,
                channelMode: requested.controls.cm,
                latency: requested.controls.lt,
                convolutionRate: requested.controls.cr
            });
            if (!config.valid) {
                this._settleRequestedAssetFailure(requested);
                this._setStatus(this._configMessage(config.message), 'error');
                return false;
            }
            const service = await this._getLibraryService();
            pcm = await service.resolveDecodedPcm(entry.irId, config.sampleRate, {
                decode: bytes => this._decodeAudioData(bytes),
                resample: (value, rate) => this._resamplePcm(value, rate),
                isCurrent: () => generation === this._generation
            });
        } catch (error) {
            if (generation !== this._generation) return false;
            console.error('IR loading failed:', error);
            this._settleRequestedAssetFailure(requested);
            this._setStatus(this._t('irReverb.error.prepare',
                'The impulse response could not be prepared. Try a shorter audio file.'), 'error');
            if (propagateFailure) throw error;
            return false;
        }
        if (generation !== this._generation) return false;
        if (!pcm) {
            this._commitMissingRequestedAsset(requested);
            return false;
        }
        requested.pcm = pcm;
        requested.hostPreparedByRate.clear();
        if (!this._applyRequestedAssetDefinition(requested)) return false;
        this.updateParameters();
        return this._prepareAndStage(generation);
    }

    _captureAssetControls() {
        return {
            cm: this.cm,
            lt: this.lt,
            cr: this.cr,
            channel: this.channel,
            dc: this.dc,
            co: this.co,
            dt: this.dt,
            tr: this.tr
        };
    }

    _applyAssetControls(controls) {
        if (!controls) return;
        this.cm = controls.cm;
        this.lt = controls.lt;
        this.cr = controls.cr;
        this.channel = controls.channel ?? null;
        this.dc = controls.dc;
        this.co = controls.co;
        this.dt = controls.dt;
        this.tr = controls.tr;
        // Restoring a revision is not a new channel-selection request.
        this._lastUpdatedChannel = this.channel;
    }

    _updateRequestedAssetControls(requested, controls) {
        if (!requested || requested.generation !== this._generation || !controls) return false;
        const previous = requested.controls;
        if (previous.cr !== controls.cr || previous.dc !== controls.dc ||
            previous.co !== controls.co || previous.dt !== controls.dt || previous.tr !== controls.tr) {
            requested.hostPreparedByRate.clear();
        }
        requested.controls = { ...controls };
        requested.controlRevision = (requested.controlRevision || 0) + 1;
        requested.externalAssetSignature = this._externalAssetSignature({
            ir: requested.ir,
            controls: requested.controls,
            sampleRate: requested.sampleRate,
            outputChannelCount: requested.outputChannelCount
        });
        if (requested.pcm) {
            const controlRevision = requested.controlRevision;
            const restart = Promise.resolve().then(() => {
                if (this._currentRequestedAssetDefinition() !== requested ||
                    requested.controlRevision !== controlRevision) return false;
                return this._prepareAndStage(requested.generation);
            });
            requested.controlRestartPromise = restart;
            restart.catch(() => {});
        }
        return true;
    }

    _restartRequestedAssetForOutputFormat(requested) {
        if (this._currentRequestedAssetDefinition() !== requested) return false;
        const generation = ++this._generation;
        const entry = requested.libraryEntry;
        const controls = { ...requested.controls };
        const propagateFailure = requested.propagateFailure;
        const readyNotice = this._pendingReadyNotice;
        this._cancelPreparationTimer();
        this._clearPreparedAsset();
        this._replacementBaseline = null;
        if (requested.serializedResolution && !entry && !requested.pcm) {
            const restart = this._resolveSerializedIr(true, {
                generation,
                ir: requested.ir,
                controls,
                sampleRate: this._sampleRate,
                outputChannelCount: this._outputChannelCount,
                propagateFailure
            });
            this._trackAssetResolution(restart, generation);
            restart.catch(() => {});
            return true;
        }
        if (entry) {
            const restart = this.loadLibraryEntry(entry, generation, {
                propagateFailure,
                readyNotice,
                controls,
                sampleRate: this._sampleRate,
                outputChannelCount: this._outputChannelCount
            });
            restart.catch(() => {});
            return true;
        }
        const migrated = this._beginRequestedAssetDefinition(generation, {
            ir: requested.ir,
            fileLabel: requested.fileLabel,
            missingIr: requested.missingIr,
            pcm: requested.pcm,
            hostPreparedByRate: new Map(),
            controls,
            sampleRate: this._sampleRate,
            outputChannelCount: this._outputChannelCount,
            propagateFailure
        });
        if (!migrated.pcm || !migrated.ir || migrated.missingIr) return false;
        this._pcm = migrated.pcm;
        this._hostPreparedByRate.clear();
        this._queuePreparation('host', 0, generation);
        return true;
    }

    _syncAssetControlUi(controls) {
        if (!controls) return;
        for (const [name, row] of this._assetControlRows) {
            const value = controls[name];
            const fields = typeof row?.querySelectorAll === 'function'
                ? row.querySelectorAll('input, select')
                : Array.from(row?.children || []).filter(element =>
                    element?.tagName === 'INPUT' || element?.tagName === 'SELECT');
            for (const field of fields) {
                if (field.type === 'checkbox') field.checked = value === true;
                else field.value = String(value);
            }
        }
        if (typeof document !== 'undefined') {
            const channel = document.getElementById?.(`${this.id}-channel-select`);
            if (channel) channel.value = controls.channel ?? '';
        }
    }

    _externalAssetSignature({
        ir = this.ir,
        controls = this._captureAssetControls(),
        sampleRate = this._getEngineSampleRate(),
        outputChannelCount = this._getEngineChannelCount()
    } = {}) {
        // IDs are content-derived and controls are numeric/enumerated; filenames
        // and other library details are intentionally absent.
        return JSON.stringify([
            1,
            ir || '',
            controls.cm,
            controls.lt,
            controls.cr,
            controls.channel ?? null,
            controls.dc === true,
            controls.co,
            controls.dt,
            controls.tr,
            sampleRate,
            outputChannelCount
        ]);
    }

    _protectedExternalAssetIds(requested = this._currentRequestedAssetDefinition()) {
        const ids = new Set();
        const addId = value => {
            if (typeof value === 'string' && value) ids.add(value);
        };
        const addSnapshot = snapshot => addId(snapshot?.ir);
        const addCandidate = candidate => {
            addSnapshot(candidate?.snapshot);
            addSnapshot(candidate?.baseline);
        };
        addId(requested?.ir);
        addId(this.ir);
        addCandidate(this._residentAssetRevisionCandidate);
        addCandidate(this._pendingAssetCandidate);
        addSnapshot(this._committedAssetSnapshot);
        addSnapshot(this._replacementBaseline);
        for (const candidate of this._assetRevisionSnapshots.values()) addCandidate(candidate);
        return [...ids];
    }

    _captureRequestedAssetDefinition(generation = this._generation, overrides = {}) {
        const controls = overrides.controls
            ? { ...overrides.controls }
            : this._captureAssetControls();
        const sampleRate = Number.isFinite(overrides.sampleRate)
            ? overrides.sampleRate
            : this._getEngineSampleRate();
        const outputChannelCount = Number.isInteger(overrides.outputChannelCount)
            ? overrides.outputChannelCount
            : this._getEngineChannelCount();
        const ir = typeof overrides.ir === 'string' ? overrides.ir : this.ir;
        const fileLabel = typeof overrides.fileLabel === 'string'
            ? overrides.fileLabel
            : this._irFileLabel;
        const missingIr = overrides.missingIr === undefined
            ? this._missingIr
            : overrides.missingIr === true;
        const pcm = Object.hasOwn(overrides, 'pcm') ? overrides.pcm : this._pcm;
        const hostPreparedByRate = overrides.hostPreparedByRate instanceof Map
            ? new Map(overrides.hostPreparedByRate)
            : new Map(this._hostPreparedByRate);
        return {
            generation,
            ir,
            fileLabel,
            missingIr,
            pcm,
            hostPreparedByRate,
            controls,
            sampleRate,
            outputChannelCount,
            controlRevision: Number.isSafeInteger(overrides.controlRevision)
                ? overrides.controlRevision
                : 0,
            propagateFailure: overrides.propagateFailure === true,
            libraryEntry: overrides.libraryEntry || null,
            serializedResolution: overrides.serializedResolution === true,
            externalAssetSignature: this._externalAssetSignature({
                ir,
                controls,
                sampleRate,
                outputChannelCount
            })
        };
    }

    _beginRequestedAssetDefinition(generation, overrides) {
        const requested = this._captureRequestedAssetDefinition(generation, overrides);
        this._requestedAssetDefinition = requested;
        return requested;
    }

    _currentRequestedAssetDefinition() {
        return this._requestedAssetDefinition?.generation === this._generation
            ? this._requestedAssetDefinition
            : null;
    }

    _requestedAssetDefinitionFor(generation) {
        const current = this._currentRequestedAssetDefinition();
        if (current?.generation === generation) return current;
        const requested = this._captureRequestedAssetDefinition(generation);
        this._requestedAssetDefinition = requested;
        return requested;
    }

    _applyRequestedAssetDefinition(requested) {
        if (!requested || requested.generation !== this._generation) return false;
        this.ir = requested.ir;
        this._irFileLabel = requested.fileLabel;
        this._missingIr = requested.missingIr;
        this._pcm = requested.pcm;
        this._hostPreparedByRate = new Map(requested.hostPreparedByRate);
        this._applyAssetControls(requested.controls);
        return true;
    }

    _commitMissingRequestedAsset(requested) {
        if (!requested || requested.generation !== this._generation) return false;
        this._pendingReadyNotice = null;
        this.ir = requested.ir;
        this._irFileLabel = requested.fileLabel;
        this._missingIr = true;
        this._applyAssetControls(requested.controls);
        this._syncAssetControlUi(requested.controls);
        this._requestedAssetDefinition = null;
        this._clearIrAsset(true);
        window.uiManager?.queueMissingExternalAssetSummary?.();
        return true;
    }

    _captureResidentSnapshot() {
        if (!this._assetResident || !this._prepared) return null;
        const controls = this._captureAssetControls();
        return {
            ir: this.ir,
            fileLabel: this._irFileLabel,
            missingIr: this._missingIr,
            pcm: this._pcm,
            hostPreparedByRate: new Map(this._hostPreparedByRate),
            prepared: this._prepared,
            controls,
            externalAssetSignature: this._externalAssetSignature({ ir: this.ir, controls })
        };
    }

    _residentBaseline() {
        return this._pendingAssetCandidate?.snapshot || this._committedAssetSnapshot ||
            this._captureResidentSnapshot();
    }

    _rememberAssetRevisionSnapshot(candidate) {
        if (!Number.isSafeInteger(candidate?.operationRevision) || !candidate?.snapshot) return;
        this._assetRevisionSnapshots.set(candidate.operationRevision, candidate);
        if (this._pruneAssetRevisionSnapshotsToDelivery()) return;
        while (this._assetRevisionSnapshots.size > 2) {
            this._assetRevisionSnapshots.delete(this._assetRevisionSnapshots.keys().next().value);
        }
    }

    _pruneAssetRevisionSnapshotsToDelivery() {
        const deliveryRevisions = this.getWasmAssetDeliveryRevisions?.(0);
        if (!(deliveryRevisions instanceof Set)) return false;
        for (const operationRevision of this._assetRevisionSnapshots.keys()) {
            if (!deliveryRevisions.has(operationRevision)) {
                this._assetRevisionSnapshots.delete(operationRevision);
            }
        }
        return true;
    }

    _findAssetRevisionCandidate(operationRevision) {
        if (this._residentAssetRevisionCandidate?.operationRevision === operationRevision) {
            return this._residentAssetRevisionCandidate;
        }
        return this._assetRevisionSnapshots.get(operationRevision) || null;
    }

    _pruneAssetRevisionSnapshots(retainedOperationRevision) {
        const retained = this._assetRevisionSnapshots.get(retainedOperationRevision);
        this._assetRevisionSnapshots.clear();
        if (retained) this._assetRevisionSnapshots.set(retainedOperationRevision, retained);
        return retained || null;
    }

    _restoreResidentSnapshot(snapshot, restoreIdentity, options = {}) {
        if (!snapshot) return false;
        const operationRevision = options.operationRevision;
        const assetState = Number.isInteger(options.assetState) ? options.assetState >>> 0 : 3;
        const status = assetState & 0xff;
        const stateConfirmed = options.stateConfirmed !== false;
        const candidate = options.candidate || this._findAssetRevisionCandidate(operationRevision);
        const previousResidentCandidate = this._residentAssetRevisionCandidate;
        const previousResidentState = this._residentAssetState;
        const previousCommittedSnapshot = this._committedAssetSnapshot;
        this.ir = snapshot.ir;
        this._irFileLabel = snapshot.fileLabel;
        this._missingIr = snapshot.missingIr;
        this._pcm = snapshot.pcm;
        this._hostPreparedByRate = new Map(snapshot.hostPreparedByRate);
        this._applyAssetControls(snapshot.controls);
        this._prepared = snapshot.prepared;
        this._assetResident = true;
        this._assetGeneration = this._generation;
        this._assetRejected = false;
        this._assetClearPending = false;
        this._pendingAdmissionRejectionGeneration = null;
        this._committedAssetSnapshot = stateConfirmed
            ? (status === 3 ? snapshot : null)
            : previousCommittedSnapshot;
        const normalizedCandidate = Number.isSafeInteger(operationRevision)
            ? {
                ...(candidate || {}),
                operationRevision,
                generation: options.normalizeGeneration === false
                    ? candidate?.generation
                    : this._generation,
                kind: candidate?.kind || (restoreIdentity ? 'identity' : 'restage'),
                baseline: status === 3 ? null : (candidate?.baseline || snapshot),
                snapshot
            }
            : null;
        this._pendingAssetCandidate = status < 3 ? normalizedCandidate : null;
        this._residentAssetRevisionCandidate = stateConfirmed
            ? normalizedCandidate
            : previousResidentCandidate;
        this._residentAssetState = stateConfirmed ? assetState : previousResidentState;
        this._replacementBaseline = null;
        if (Number.isSafeInteger(operationRevision)) {
            const baselineCandidate = status < 3
                ? [...this._assetRevisionSnapshots.values()].find(item =>
                    item?.snapshot === normalizedCandidate?.baseline) ||
                    (previousResidentCandidate?.snapshot === normalizedCandidate?.baseline
                        ? previousResidentCandidate
                        : null)
                : null;
            this._assetRevisionSnapshots.clear();
            if (baselineCandidate && baselineCandidate.operationRevision !== operationRevision) {
                this._assetRevisionSnapshots.set(
                    baselineCandidate.operationRevision,
                    baselineCandidate
                );
            }
            if (normalizedCandidate) this._assetRevisionSnapshots.set(operationRevision, normalizedCandidate);
        }
        if (options.preserveRequested !== true) {
            this._requestedAssetDefinition = null;
            this._pendingReadyNotice = null;
        }
        if (options.preserveRequested !== true) this._syncAssetControlUi(snapshot.controls);
        this._updatePowerGainBound();
        this.updateParameters();
        this._updateMetadata();
        this._drawEdcGraph();
        return true;
    }

    _restoreReplacementBaseline() {
        const baseline = this._replacementBaseline;
        if (!baseline) return false;
        const operationRevision = this.getWasmAssetOperationRevision(0);
        const recordedStateRevision = this._wasmAssetStateRevisions?.get(0);
        const recordedState = this._wasmAssetStates?.get(0);
        const recordedStateMatches = recordedStateRevision === operationRevision &&
            Number.isInteger(recordedState);
        const residentStateMatches = this._residentAssetRevisionCandidate?.operationRevision ===
            operationRevision;
        const stateConfirmed = recordedStateMatches || residentStateMatches;
        const assetState = recordedStateMatches
            ? recordedState
            : residentStateMatches
                ? this._residentAssetState
                : 1;
        return this._restoreResidentSnapshot(baseline, true, {
            operationRevision,
            assetState,
            candidate: this._findAssetRevisionCandidate(operationRevision),
            stateConfirmed
        });
    }

    _settleRequestedAssetFailure(requested) {
        if (!requested || requested.generation !== this._generation) return false;
        this._pendingReadyNotice = null;
        if (!this._restoreReplacementBaseline()) {
            const rollbackControls = this._captureAssetControls();
            this._clearPreparedAsset();
            this._syncAssetControlUi(rollbackControls);
        }
        return true;
    }

    _adoptRetainedSnapshotDuringNewerPreparation(candidate, assetState) {
        if (!candidate?.snapshot) return false;
        const requested = this._currentRequestedAssetDefinition() ||
            this._captureRequestedAssetDefinition(this._generation);
        this._requestedAssetDefinition = requested;
        if (!this._restoreResidentSnapshot(candidate.snapshot, true, {
            operationRevision: candidate.operationRevision,
            assetState,
            candidate,
            preserveRequested: true,
            normalizeGeneration: false
        })) return false;
        this._replacementBaseline = candidate.snapshot;
        return true;
    }

    _discardAssetCandidate({ discardCommitted = false } = {}) {
        this._pendingAssetCandidate = null;
        this._replacementBaseline = null;
        if (discardCommitted) {
            this._committedAssetSnapshot = null;
            this._residentAssetRevisionCandidate = null;
            this._residentAssetState = 0;
            this._requestedAssetDefinition = null;
            this._assetRevisionSnapshots.clear();
        }
    }

    _clearLocalWasmAsset() {
        const waitForClear = this._assetResident && !this._assetRejected;
        this._assetResident = false;
        this._assetGeneration = null;
        this._assetRejected = false;
        this._pendingAdmissionRejectionGeneration = null;
        const clearedTargets = this.clearWasmAsset(0);
        this._assetClearPending = waitForClear && clearedTargets > 0;
    }

    _clearPreparedAsset() {
        this._pendingReadyNotice = null;
        this._discardAssetCandidate({ discardCommitted: true });
        this._clearLocalWasmAsset();
        this._prepared = null;
        this._updatePowerGainBound();
        this.updateParameters();
        this._updateMetadata();
        this._drawEdcGraph();
    }

    _clearIrAsset(missing) {
        this._pendingReadyNotice = null;
        this._discardAssetCandidate({ discardCommitted: true });
        this._clearLocalWasmAsset();
        this._pcm = null;
        this._prepared = null;
        this._hostPreparedByRate.clear();
        this._missingIr = missing;
        this._updatePowerGainBound();
        this.updateParameters();
        this._updateMetadata();
        this._drawEdcGraph();
        this._restoreClearedStatus();
    }

    _restoreClearedStatus() {
        if (this._missingIr && this.ir) {
            this._setStatus(this._t('irReverb.error.notFound', 'IR not found: {name}', {
                name: this.ir ? `IR ${this.ir.slice(0, 8)}` :
                    this._t('irReverb.name.impulseResponse', 'Impulse response')
            }), 'error');
            return;
        }
        this._setStatus(this._t('irReverb.status.importPrompt',
            'Import an impulse response to use IR Reverb.'), '');
    }

    async _openLibraryBrowser() {
        try {
            const [browser, service] = await Promise.all([
                import('../../js/ir-library/browser.js'),
                this._getLibraryService()
            ]);
            browser.openIrLibraryBrowser({
                service,
                audioManager: window.uiManager?.audioManager,
                onLoad: entry => this.loadLibraryEntry(entry)
            });
        } catch (error) {
            console.error('IR library browser failed:', error);
            this._setStatus(this._t('irReverb.error.openLibrary',
                'The impulse response library could not be opened.'), 'error');
        }
    }

    async _getWorkerClient(runtime) {
        if (!this._workerClient) this._workerClient = runtime.createIrPreparationWorkerClient();
        return this._workerClient;
    }

    _hostPreparationKey(config) {
        return `${config.sampleRate}:${config.topology === 3 ? 'joint' : 'paths'}`;
    }

    onChannelSelectionChanged(previousChannel, nextChannel) {
        const requested = this._currentRequestedAssetDefinition();
        if (requested) {
            this._updateRequestedAssetControls(requested, {
                ...requested.controls,
                channel: nextChannel ?? null
            });
            this.channel = previousChannel ?? null;
            this._lastUpdatedChannel = this.channel;
            return;
        }
        if (this._pcm) this._queuePreparation('restage', 0);
    }

    _getEngineSampleRate() {
        const value = this._sampleRate || window.workletNode?.context?.sampleRate ||
            window.audioContext?.sampleRate || window.uiManager?.audioManager?.audioContext?.sampleRate;
        return Number.isFinite(value) && value > 0 ? value : 48000;
    }

    _getEngineChannelCount() {
        const candidates = [
            this._outputChannelCount,
            window.workletNode?.channelCount,
            window.audioManager?.outputChannelCount,
            window.uiManager?.audioManager?.outputChannelCount
        ];
        const value = candidates.find(candidate => Number.isInteger(candidate) && candidate >= 1 && candidate <= 8);
        return value || 2;
    }

    async _decodeAudioData(bytes) {
        let context = window.workletNode?.context || window.audioContext ||
            window.uiManager?.audioManager?.audioContext;
        let ownsContext = false;
        if (!context?.decodeAudioData) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (typeof AudioContextClass !== 'function') {
                throw new Error('Audio decoding is unavailable');
            }
            context = new AudioContextClass({ sampleRate: this._getEngineSampleRate() });
            ownsContext = true;
        }
        try {
            const audioBuffer = await context.decodeAudioData(bytes.slice(0));
            if (audioBuffer.numberOfChannels < 1 || audioBuffer.numberOfChannels > 8 || audioBuffer.length < 1) {
                throw new Error('Unsupported decoded channel layout');
            }
            const channels = [];
            for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
                channels.push(new Float32Array(audioBuffer.getChannelData(channel)));
            }
            return { channels, sampleRate: audioBuffer.sampleRate };
        } finally {
            if (ownsContext) await context.close?.();
        }
    }

    async _resamplePcm(pcm, targetSampleRate) {
        if (Math.round(pcm.sampleRate) === Math.round(targetSampleRate)) return pcm;
        const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (typeof OfflineAudioContextClass !== 'function') {
            throw new Error('Offline sample-rate conversion is unavailable');
        }
        const frames = Math.max(1, Math.round(pcm.channels[0].length * targetSampleRate / pcm.sampleRate));
        const context = new OfflineAudioContextClass(pcm.channels.length, frames, targetSampleRate);
        const buffer = context.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
        for (let channel = 0; channel < pcm.channels.length; channel += 1) {
            buffer.copyToChannel(pcm.channels[channel], channel);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start();
        const rendered = await context.startRendering();
        const channels = [];
        for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
            channels.push(new Float32Array(rendered.getChannelData(channel)));
        }
        return { channels, sampleRate: rendered.sampleRate };
    }

    _updatePowerGainBound() {
        if (this._prepared?.config?.rateDivider !== 1) {
            this.powerGainUpperBoundDb = null;
            return;
        }
        const irBoundDb = this._prepared?.analysis?.l1GainUpperBoundDb;
        if (!Number.isFinite(irBoundDb)) {
            this.powerGainUpperBoundDb = null;
            return;
        }
        const dryAmplitude = this.dl <= -96 ? 0 : 10 ** (this.dl / 20);
        const wetAmplitude = 10 ** ((this.dw + irBoundDb) / 20);
        this.powerGainUpperBoundDb = 20 * Math.log10(dryAmplitude + wetAmplitude);
    }

    onWasmAssetResidency(slot, state, operationRevision) {
        if (slot !== 0) return;
        const status = state & 0xff;
        if (status < 1 || status > 3) {
            this._residentAssetRevisionCandidate = null;
            this._residentAssetState = 0;
            return;
        }
        const candidate = this._findAssetRevisionCandidate(operationRevision) ||
            (this._pendingAssetCandidate?.operationRevision === operationRevision
                ? this._pendingAssetCandidate
                : null);
        if (!candidate?.snapshot) return;
        this._residentAssetRevisionCandidate = candidate;
        this._residentAssetState = state >>> 0;
        this._pruneAssetRevisionSnapshotsToDelivery();
    }

    onWasmAssetState(slot, state, operationRevision) {
        this.onWasmAssetResidency(slot, state, operationRevision);
        if (slot !== 0 || !this._isCurrentWasmAssetOperation(slot, operationRevision)) return;
        const status = state & 0xff;
        const trackedCandidate = this._findAssetRevisionCandidate(operationRevision);
        const supersededByNewerPreparation = trackedCandidate !== null &&
            trackedCandidate.generation !== this._generation;
        if (status === 0) {
            this._assetClearPending = false;
            if (!this._assetResident && !this._pcm) this._restoreClearedStatus();
            return;
        }
        if (!this._assetResident || this._assetClearPending) return;
        if (this._assetGeneration !== this._generation && !supersededByNewerPreparation) return;
        if (supersededByNewerPreparation && status < 3) return;
        switch (status) {
            case 1:
                this._assetRejected = false;
                this._setStatus(this._t('irReverb.status.wasmNotReady',
                    'WASM audio processing is not ready. IR Reverb is passing dry signal through.'), 'preparing');
                break;
            case 2:
                this._assetRejected = false;
                this._setStatus(this._t('irReverb.status.preparing', 'Preparing the impulse response…'), 'preparing');
                break;
            case 3: {
                this._assetRejected = false;
                this._pendingAssetCandidate = null;
                const committedCandidate = trackedCandidate
                    ? { ...trackedCandidate, baseline: null }
                    : null;
                this._committedAssetSnapshot = committedCandidate?.snapshot ||
                    this._committedAssetSnapshot || this._captureResidentSnapshot();
                if (committedCandidate) {
                    this._residentAssetRevisionCandidate = committedCandidate;
                    this._residentAssetState = state >>> 0;
                    this._assetRevisionSnapshots.set(operationRevision, committedCandidate);
                }
                if (committedCandidate) this._pruneAssetRevisionSnapshots(operationRevision);
                if (supersededByNewerPreparation) {
                    this._replacementBaseline = this._committedAssetSnapshot;
                    return;
                }
                const readyNotice = this._pendingReadyNotice;
                this._pendingReadyNotice = null;
                this._setStatus(readyNotice || this._t('irReverb.status.ready', '{name} is ready.', {
                    name: this._irFileLabel || this._t('irReverb.name.theImpulseResponseCapitalized', 'The impulse response')
                }), 'ready');
                break;
            }
            case 4:
                this._assetRejected = true;
                this._discardAssetCandidate({ discardCommitted: true });
                this._clearPreparedAsset();
                this._pendingAdmissionRejectionGeneration = this._generation;
                this._setStatus(this._t('irReverb.error.rejected',
                    'The impulse response was rejected. Try a shorter file or a higher latency.'), 'error');
                break;
            default:
                break;
        }
    }

    onWasmAssetRejected(slot, reason, operationRevision, retention = {}) {
        if (slot !== 0 || !this._isCurrentWasmAssetOperation(slot, operationRevision)) return;
        const rejectedCandidate = this._findAssetRevisionCandidate(operationRevision) ||
            (this._pendingAssetCandidate?.operationRevision === operationRevision
                ? this._pendingAssetCandidate
                : null);
        const currentCandidate = this._assetResident && !this._assetClearPending;
        const supersededByNewerPreparation = rejectedCandidate !== null &&
            rejectedCandidate.generation !== this._generation;
        const followsCurrentStateRejection =
            this._pendingAdmissionRejectionGeneration === this._generation;
        if (!currentCandidate && !followsCurrentStateRejection) return;
        console.warn('IR Reverb asset admission rejected:', reason);
        this._pendingAdmissionRejectionGeneration = null;
        const retainedOperationRevision = retention.retainedOperationRevision;
        const retainedAssetState = Number.isInteger(retention.retainedAssetState)
            ? retention.retainedAssetState >>> 0
            : 3;
        const retainedStatus = retainedAssetState & 0xff;
        const retainedCandidate = this._findAssetRevisionCandidate(retainedOperationRevision);
        if (retention.residentRetained === true && retainedStatus >= 1 && retainedStatus <= 3 &&
            rejectedCandidate !== null && retainedCandidate?.snapshot) {
            if (supersededByNewerPreparation) {
                this._adoptRetainedSnapshotDuringNewerPreparation(
                    retainedCandidate,
                    retainedAssetState
                );
                return;
            }
            const restoreIdentity = rejectedCandidate.kind === 'identity' ||
                retainedCandidate.snapshot.ir !== this.ir;
            if (!this._restoreResidentSnapshot(retainedCandidate.snapshot, restoreIdentity, {
                operationRevision: retainedOperationRevision,
                assetState: retainedAssetState,
                candidate: retainedCandidate
            })) return;
            this._setStatus(this._t('irReverb.error.memory',
                'There is not enough audio-processing memory for this impulse response.'), 'error');
            return;
        }
        if (currentCandidate) {
            this._assetRejected = true;
            this._discardAssetCandidate({ discardCommitted: true });
            this._clearPreparedAsset();
        }
        this._setStatus(this._t('irReverb.error.memory',
            'There is not enough audio-processing memory for this impulse response.'), 'error');
    }

    _setStatus(message, state = '') {
        this._statusMessage = message;
        this._statusState = state;
        if (!this._statusElement) return;
        this._statusElement.textContent = message;
        this._statusElement.dataset.state = state;
    }

    getEdcGraphData() {
        if (!this._prepared?.analysis) return null;
        const { analysis, sampleRate, frames } = this._prepared;
        return {
            durationSeconds: Math.max(
                frames / sampleRate,
                analysis.original.frames / sampleRate,
                this.pd / 1000,
                0.001
            ),
            original: {
                sampleFrames: analysis.original.sampleFrames,
                envelope: analysis.original.envelope,
                edcDb: analysis.original.edcDb
            },
            current: {
                sampleFrames: analysis.sampleFrames,
                envelope: analysis.envelope,
                edcDb: analysis.edcDb
            },
            markers: {
                onset: Math.max(0, analysis.onsetFrame - analysis.sourceStartFrame) / sampleRate,
                cut: !this.dc || analysis.cutFrame === null
                    ? null
                    : Math.max(0, analysis.cutFrame - analysis.sourceStartFrame) / sampleRate,
                predelay: this.pd / 1000,
                trim: frames / sampleRate,
                rt60: analysis.rt60Seconds
            },
            rt60Label: Number.isFinite(analysis.rt60Seconds)
                ? `RT60 ${analysis.rt60Seconds.toFixed(2)} s`
                : this._t('irReverb.graph.rt60Unavailable', 'RT60 unavailable')
        };
    }

    _updateMetadata() {
        if (!this._pcm || !this._prepared) {
            this._metadataText = this._t('irReverb.metadata.none', 'No impulse response loaded.');
        } else {
            const engineRate = this._getEngineSampleRate();
            const { config, frames, sampleRate, footprintBytes, maximumFrames } = this._prepared;
            const sourceSeconds = this._pcm.channels[0].length / this._pcm.sampleRate;
            const effectiveSeconds = frames / sampleRate;
            const latencySamples = config.headBlock * config.rateDivider +
                126 * (config.rateDivider - 1);
            const latencyMs = latencySamples * 1000 / engineRate;
            const memoryMiB = footprintBytes / (1024 * 1024);
            const topologyNames = {
                mono: this._t('irReverb.option.mono', 'Mono'),
                indep: this._t('irReverb.option.independent', 'Independent'),
                true: this._t('irReverb.option.trueStereo', 'True Stereo'),
                multi: this._t('irReverb.option.diagonalMatrix', 'Diagonal Matrix')
            };
            const topology = topologyNames[config.channelMode] || config.channelMode;
            const maximumSeconds = maximumFrames / sampleRate;
            const limitNote = this._t('irReverb.metadata.limit', '{active} s active / {limit} s limit', {
                active: effectiveSeconds.toFixed(2),
                limit: maximumSeconds.toFixed(2)
            });
            this._metadataText = `${this._irFileLabel || this._t('irReverb.name.importedIr', 'Imported IR')} · ${sourceSeconds.toFixed(2)} s · ` +
                `${this._pcm.channels.length} ch · ${topology} · ${limitNote} · ` +
                `${Math.round(engineRate / 100) / 10} → ${Math.round(sampleRate / 100) / 10} kHz · ` +
                `${latencySamples} samples / ${latencyMs.toFixed(2)} ms · ${memoryMiB.toFixed(1)} MiB`;
        }
        if (this._metadataElement) this._metadataElement.textContent = this._metadataText;
    }

    _drawEdcGraph() {
        const canvas = this._graphCanvas;
        if (!canvas) return;
        const context = canvas.getContext?.('2d');
        if (!context) return;
        const rect = canvas.getBoundingClientRect?.();
        const cssWidth = rect?.width || canvas.clientWidth || canvas.width;
        const cssHeight = rect?.height || canvas.clientHeight || canvas.height;
        const dpr = canvas.width / cssWidth || 1;
        const width = Math.max(1, Math.round(cssWidth));
        const height = Math.max(1, Math.round(cssHeight));
        context.setTransform?.(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        const graph = this.getEdcGraphData();
        if (!graph) return;
        const fontSize = width < 400 ? 11 : 12;
        const labelLineHeight = fontSize + 3;
        const labelTop = 5;
        const markerLabelRows = 3;
        const left = 42;
        const right = 12;
        const top = labelTop + labelLineHeight * markerLabelRows + 4;
        const bottom = 25;
        const plotWidth = Math.max(1, width - left - right);
        const plotHeight = Math.max(1, height - top - bottom);
        const x = seconds => left + seconds / graph.durationSeconds * plotWidth;
        const y = db => top + Math.min(1, Math.max(0, -db / 90)) * plotHeight;

        context.fillStyle = '#222';
        context.fillRect(0, 0, width, height);
        context.strokeStyle = '#444';
        context.fillStyle = '#666';
        context.font = `${fontSize}px Arial`;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.lineWidth = 1;
        const measureTextWidth = text =>
            context.measureText?.(text)?.width || text.length * fontSize * 0.6;
        for (const db of [0, -30, -60, -90]) {
            context.beginPath();
            context.moveTo(left, y(db));
            context.lineTo(width - right, y(db));
            context.stroke();
            context.fillText(`${db}`, 4, y(db) + 4);
        }

        const timeLabel = this._t('irReverb.graph.time', 'Time');
        const timeLabelWidth = Math.min(measureTextWidth(timeLabel), plotWidth);
        const timeLabelLeft = width - right - timeLabelWidth;
        context.strokeStyle = '#444';
        context.fillStyle = '#666';
        context.textAlign = 'center';
        for (let second = 1; second <= Math.floor(graph.durationSeconds); second += 1) {
            const px = x(second);
            const tickLabel = `${second} s`;
            const tickLabelWidth = measureTextWidth(tickLabel);
            if (px + tickLabelWidth / 2 + 4 >= timeLabelLeft) continue;
            context.beginPath();
            context.moveTo(px, height - bottom);
            context.lineTo(px, height - bottom + 5);
            context.stroke();
            context.fillText(tickLabel, px, height - 5);
        }

        const envelopePeak = graph.current.envelope.reduce((peak, value) => value > peak ? value : peak, 0);
        if (envelopePeak > 0) {
            context.beginPath();
            context.moveTo(left, height - bottom);
            for (let index = 0; index < graph.current.envelope.length; index += 1) {
                const px = x(graph.current.sampleFrames[index] / this._prepared.sampleRate);
                const magnitude = graph.current.envelope[index] / envelopePeak;
                const amplitudeDb = magnitude > 0 ? 20 * Math.log10(magnitude) : -90;
                const py = y(amplitudeDb);
                context.lineTo(px, py);
            }
            context.lineTo(width - right, height - bottom);
            context.closePath();
            context.globalAlpha = 0.18;
            context.fillStyle = '#00ff00';
            context.fill();
            context.globalAlpha = 1;
        }

        const drawLine = (series, color, dash) => {
            context.beginPath();
            context.setLineDash(dash);
            context.strokeStyle = color;
            context.lineWidth = 2;
            for (let index = 0; index < series.edcDb.length; index += 1) {
                const px = x(series.sampleFrames[index] / this._prepared.sampleRate);
                const py = y(series.edcDb[index]);
                if (index === 0) context.moveTo(px, py);
                else context.lineTo(px, py);
            }
            context.stroke();
        };
        drawLine(graph.original, '#808080', [5, 5]);
        drawLine(graph.current, '#00ff00', []);

        const markerColors = {
            onset: '#fff',
            cut: '#ff0000',
            predelay: '#808080',
            trim: '#00ff00',
            rt60: '#fff'
        };
        const markerLabels = {
            onset: this._t('irReverb.graph.onset', 'onset'),
            cut: this._t('irReverb.graph.cut', 'cut'),
            predelay: this._t('irReverb.graph.preDelay', 'pre-delay'),
            trim: this._t('irReverb.graph.trim', 'trim')
        };
        const drawMarkerLabel = (text, px, row) => {
            context.textAlign = 'left';
            const maxWidth = plotWidth;
            const measuredWidth = Math.min(measureTextWidth(text), maxWidth);
            let labelX = px + 4;
            if (labelX + measuredWidth > width - right) labelX = px - measuredWidth - 4;
            labelX = Math.max(left, Math.min(labelX, width - right - measuredWidth));
            const labelY = labelTop + labelLineHeight * (row + 1) - 2;
            context.fillText(text, labelX, labelY, maxWidth);
        };
        context.setLineDash([]);
        context.lineWidth = 1;
        context.fillStyle = markerColors.rt60;
        drawMarkerLabel(graph.rt60Label, left - 4, 0);
        let labelRow = 1;
        for (const [label, seconds] of Object.entries(graph.markers)) {
            if (!Number.isFinite(seconds) || seconds < 0 || seconds > graph.durationSeconds) continue;
            const px = x(seconds);
            context.strokeStyle = markerColors[label];
            context.fillStyle = markerColors[label];
            context.beginPath();
            context.moveTo(px, top);
            context.lineTo(px, height - bottom);
            context.stroke();
            if (label !== 'rt60') {
                drawMarkerLabel(markerLabels[label] || label, px, labelRow);
                labelRow = labelRow === markerLabelRows - 1 ? 1 : labelRow + 1;
            }
        }
        context.fillStyle = '#fff';
        context.textAlign = 'right';
        context.fillText(timeLabel, width - right, height - 5, plotWidth);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui ir-reverb-ui';

        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'audio/*,.wav,.flac,.aif,.aiff';
        input.hidden = true;
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            if (files.length) this.importFiles(files);
            input.value = '';
        });
        container.appendChild(input);

        const importActions = document.createElement('div');
        importActions.className = 'ir-reverb-import-actions';
        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.textContent = this._t('irReverb.action.importFile', 'Import file…');
        importButton.addEventListener('click', () => input.click());
        const libraryButton = document.createElement('button');
        libraryButton.type = 'button';
        libraryButton.textContent = this._t('irReverb.action.chooseLibrary', 'Choose from library…');
        libraryButton.addEventListener('click', () => this._openLibraryBrowser());

        const status = document.createElement('div');
        status.className = 'ir-reverb-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        this._statusElement = status;
        this._setStatus(this._statusMessage || this._t('irReverb.status.importPrompt',
            'Import an impulse response to use IR Reverb.'), this._statusState);
        importActions.append(importButton, libraryButton, status);
        container.appendChild(importActions);

        const metadata = document.createElement('div');
        metadata.className = 'ir-reverb-metadata';
        this._metadataElement = metadata;
        this._updateMetadata();
        container.appendChild(metadata);

        const graph = this.createResponsiveGraph({
            maxWidth: 760,
            aspectRatio: '3 / 1',
            mobileAspectRatio: '2 / 1',
            className: 'ir-reverb-edc',
            onResize: () => this._drawEdcGraph()
        });
        this._graphCanvas = graph.canvas;
        graph.container.setAttribute('aria-label', this._t('irReverb.aria.edcGraph',
            'Impulse response energy decay graph'));
        container.appendChild(graph.container);

        const appendAssetControl = (name, row) => {
            this._assetControlRows.set(name, row);
            container.appendChild(row);
        };
        appendAssetControl('cm', this.createSelectControl(this._t('irReverb.parameter.channelMode', 'Channel Mode'), [
            { value: 'auto', label: this._t('irReverb.option.auto', 'Auto') },
            { value: 'mono', label: this._t('irReverb.option.mono', 'Mono') },
            { value: 'indep', label: this._t('irReverb.option.independent', 'Independent') },
            { value: 'true', label: this._t('irReverb.option.trueStereo', 'True Stereo') },
            { value: 'multi', label: this._t('irReverb.option.diagonalMatrix', 'Diagonal Matrix') }
        ], this.cm, value => this.setParameters({ cm: value })));
        appendAssetControl('lt', this.createSelectControl(this._t('irReverb.parameter.latency', 'Latency'), [
            { value: '0', label: this._t('irReverb.option.zero', 'Zero') },
            ...[128, 256, 512, 1024].map(value => ({
                value: String(value),
                label: this._t('irReverb.option.samples', '{count} samples', { count: value })
            }))
        ], this.lt, value => this.setParameters({ lt: value })));
        appendAssetControl('cr', this.createSelectControl(this._t('irReverb.parameter.convolutionRate', 'Convolution Rate'), [
            { value: 'auto', label: this._t('irReverb.option.auto', 'Auto') },
            { value: 'full', label: this._t('irReverb.option.full', 'Full') },
            { value: 'half', label: this._t('irReverb.option.half', 'Half') },
            { value: 'quarter', label: this._t('irReverb.option.quarter', 'Quarter') }
        ], this.cr, value => this.setParameters({ cr: value })));
        container.appendChild(this.createParameterControl(this._t('irReverb.parameter.wet', 'Wet'), -96, 12, 0.1, this.dw, value => this.setParameters({ dw: value }), 'dB'));
        container.appendChild(this.createParameterControl(this._t('irReverb.parameter.dry', 'Dry'), -96, 12, 0.1, this.dl, value => this.setParameters({ dl: value }), 'dB'));
        container.appendChild(this.createParameterControl(this._t('irReverb.parameter.preDelay', 'Pre Delay'), 0, 500, 0.1, this.pd, value => this.setParameters({ pd: value }), 'ms'));
        appendAssetControl('dc', this.createCheckboxControl(this._t('irReverb.parameter.directCut', 'Direct Cut'), this.dc, value => this.setParameters({ dc: value })));
        appendAssetControl('co', this.createParameterControl(this._t('irReverb.parameter.cutOffset', 'Cut Offset'), -20, 50, 0.1, this.co, value => this.setParameters({ co: value }), 'ms'));
        appendAssetControl('dt', this.createParameterControl(this._t('irReverb.parameter.decay', 'Decay'), 10, 400, 1, this.dt, value => this.setParameters({ dt: value }), '%'));
        appendAssetControl('tr', this.createParameterControl(this._t('irReverb.parameter.trim', 'Trim'), 1, 100, 1, this.tr, value => this.setParameters({ tr: value }), '%'));

        return container;
    }

    cleanup() {
        ++this._generation;
        this._cancelPreparationTimer();
        this._workerClient?.close();
        this._workerClient = null;
        this._pcm = null;
        this._hostPreparedByRate.clear();
        this._prepared = null;
        this._assetResident = false;
        this._assetGeneration = null;
        this._assetRejected = false;
        this._assetClearPending = false;
        this._pendingAdmissionRejectionGeneration = null;
        this._committedAssetSnapshot = null;
        this._pendingAssetCandidate = null;
        this._replacementBaseline = null;
        this._residentAssetRevisionCandidate = null;
        this._residentAssetState = 0;
        this._requestedAssetDefinition = null;
        this._assetResolutionPromise = null;
        this._assetResolutionGeneration = null;
        this._assetRevisionSnapshots.clear();
        this._assetControlRows.clear();
        this._pendingReadyNotice = null;
        this._statusElement = null;
        this._metadataElement = null;
        this._graphCanvas = null;
        super.cleanup();
    }
}

window.IRReverbPlugin = IRReverbPlugin;

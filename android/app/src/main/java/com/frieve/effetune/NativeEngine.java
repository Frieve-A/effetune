package com.frieve.effetune;

/** Service-owned native audio engine. Control calls must use one executor. */
public final class NativeEngine implements AutoCloseable {
    static { System.loadLibrary("effetune_android"); }
    private long handle;
    private final int channelCount;
    public NativeEngine(int sampleRate, int maxFrames) { this(sampleRate, maxFrames, 2); }
    NativeEngine(int sampleRate, int maxFrames, int channels) {
        channelCount = channels;
        handle = create(sampleRate, maxFrames, channels);
    }
    public int getChannelCount() { return channelCount; }
    static NativeEngine createBenchmark(int sampleRate, int blockSize, int channels) {
        return new NativeEngine(sampleRate, blockSize, channels);
    }
    long[] benchmark(byte[] input, int channels, int warmupBlocks, long durationNs) {
        return runBenchmark(handle, input, channels, warmupBlocks, durationNs);
    }
    public int start() { return start(handle); }
    boolean checkOutputFormat() { return checkOutputFormat(handle); }
    private static native boolean checkOutputFormat(long handle);
    /** Output status of a DSP graph that cannot render; matches the native constant. */
    public static final int PIPELINE_FAILED = -1;
    /** Control-owner reconciliation: 1 running, 0 stopped, PIPELINE_FAILED, or a negative Oboe error. */
    public int getOutputStatus() { return outputStatus(handle); }
    /** Once per control tick: the rate that counts burst and buffer frames, burst, buffer size, XRuns, failed renders,
     *  source and input underruns, and the output hardware rate (0 when the OS does not report it). */
    public int[] observeOutput() { return observeOutput(handle); }
    public int getInputSessionId() { return inputSessionId(handle); }
    int setNetworkOutput(boolean attached, boolean paused) { return networkOutput(handle, attached, paused); }
    int setNetworkLocalDelay(int request, boolean active, double ms, boolean local) {
        return networkLocalDelay(handle, request, active, ms, local);
    }
    int setNetworkReceiveSession(boolean active, long generation) { return networkReceive(handle, active, generation); }
    void setLiveInput(boolean enabled) { liveInput(handle, enabled); }
    void activateLiveInput(long generation) { liveActivate(handle, generation); }
    int writeLivePcm(float[] pcm, int frames) { return liveWrite(handle, pcm, frames); }
    double livePosition() { return livePosition(handle); }
    private static native void liveInput(long handle, boolean enabled);
    private static native void liveActivate(long handle, long generation);
    private static native int liveWrite(long handle, float[] pcm, int frames);
    private static native double livePosition(long handle);
    int acknowledgeNetwork(long epoch, long frame) { return networkAck(handle, epoch, frame); }
    boolean popNetworkPacket(short[] pcm, long[] indices, double[] timing) { return networkPacket(handle, pcm, indices, timing); }
    String readNetworkReports(boolean force) { return networkReports(handle, force); }
    private static native int networkOutput(long handle, boolean attached, boolean paused);
    private static native int networkLocalDelay(long handle, int request, boolean active, double ms, boolean local);
    private static native int networkReceive(long handle, boolean active, long generation);
    private static native int networkAck(long handle, long epoch, long frame);
    private static native boolean networkPacket(long handle, short[] pcm, long[] indices, double[] timing);
    private static native String networkReports(long handle, boolean force);
    public void stop() { stop(handle); }
    public void prepareResume() { prepareResume(handle); }
    @Override public void close() { if (handle != 0) { destroy(handle); handle = 0; } }
    public int getSampleRate() { return sampleRate(handle); }
    public int getOutputDeviceId() { return outputDeviceId(handle); }
    public int setOutputDevice(int deviceId) { return outputDevice(handle, deviceId); }
    /** 0 interactive, 1 balanced, 2 playback. */
    public int setLatency(int mode) { return latency(handle, mode); }
    /** Applies the output device and the latency mode together, with one reopen of a running output. */
    public int setOutput(int deviceId, int mode) { return output(handle, deviceId, mode); }
    public void setMeasurementNoiseFile(int fd, int frames) { measurementNoiseFile(handle, fd, frames); }
    public void stopMeasurementNoise() { stopMeasurementNoise(handle); }
    int measurementChannels() { return measurementChannels(handle); }
    int openMeasurementStreams(int rate, int device, int output, int width) {
        return measurementStreams(handle, rate, device, output, width, false);
    }
    int closeMeasurementStreams(boolean restart) {
        return measurementStreams(handle, 0, -1, 0, channelCount, restart);
    }
    int measurementRate() { return measurementRate(handle); }
    void startDuplexCapture(int input, int output, int excitationFrames, int frames, float peak, int tail, int channel) {
        duplexCapture(handle, input, output, excitationFrames, frames, peak, tail, channel);
    }
    private static native void duplexCapture(long handle, int input, int output, int excitationFrames, int frames,
                                             float peak, int tail, int channel);
    int measurementInputDevice() { return measurementInputDevice(handle); }
    void setMeasurementPipeline(boolean enabled) { measurementPipeline(handle, enabled); }
    private static native int measurementStreams(long handle, int rate, int device, int output, int width, boolean restart);
    private static native int measurementRate(long handle);
    private static native int measurementChannels(long handle);
    private static native int measurementInputDevice(long handle);
    private static native void measurementPipeline(long handle, boolean enabled);
    /** -1 off; otherwise the metered input channel (0 left, 1 right, 2 average), kept out of playback. */
    public void setMeasurementMeter(int channel) { measurementMeter(handle, channel); }
    public int setInputDevice(int deviceId) { return inputDevice(handle, deviceId); }
    public int[] configurePipeline(String[] types, float[][] parameters, int[] hashes, int[] ids, byte[] descriptor, byte[][] structured) {
        return configurePipeline(types, parameters, hashes, ids, descriptor, structured, new byte[types.length]);
    }
    /** Flags per effect: SKIP_FLAG for an unsupported effect, DISPLAY_ONLY_FLAG for a display-only effect. */
    public int[] configurePipeline(String[] types, float[][] parameters, int[] hashes, int[] ids, byte[] descriptor, byte[][] structured, byte[] flags) {
        return configure(handle, types, parameters, hashes, ids, descriptor, structured, flags);
    }
    public int startParallel() { return startParallel(-1, 1); }
    public int startParallel(int scoreFd, double speed) { return startParallel(handle, scoreFd, speed); }
    public void stopParallel() { stopParallel(handle); }
    public int selectParallel(int branch, double seconds) { return selectParallel(handle, branch, seconds); }
    public int setOutputDelay(int branch, int samples) { return outputDelay(handle, branch, samples); }
    public int fadeOutput(int branch, float gain, double seconds) { return fadeOutput(handle, branch, gain, seconds); }
    public int[] configurePipeline(String[] types, float[][] parameters, int[] hashes, int[] ids, byte[] descriptor, byte[][] structured, byte[] flags, int branch) {
        return configureBranch(handle, types, parameters, hashes, ids, descriptor, structured, flags, branch);
    }
    public int setParameters(int instance, float[] values, int hash, int branch) { return branchParameters(handle, instance, values, hash, branch); }
    public int setParameterBytes(int instance, byte[] values, int hash, int branch) { return branchParameterBytes(handle, instance, values, hash, branch); }
    public double[] readPipelineStats(int branch) { return branchStats(handle, branch); }
    private static native int startParallel(long handle, int scoreFd, double speed);
    private static native void stopParallel(long handle);
    private static native int selectParallel(long handle, int branch, double seconds);
    private static native int outputDelay(long handle, int branch, int samples);
    private static native int fadeOutput(long handle, int branch, float gain, double seconds);
    private static native int[] configureBranch(long handle, String[] types, float[][] parameters, int[] hashes, int[] ids, byte[] descriptor, byte[][] structured, byte[] flags, int branch);
    private static native int branchParameters(long handle, int instance, float[] values, int hash, int branch);
    private static native int branchParameterBytes(long handle, int instance, byte[] values, int hash, int branch);
    private static native double[] branchStats(long handle, int branch);
    public static final byte SKIP_FLAG = 1, DISPLAY_ONLY_FLAG = 2;
    /** Desktop audioProcessingOverload event: 1 active, 0 cleared, -1 none. */
    public int takeOverload() { return takeOverload(handle); }
    /** Desktop setDisplayDspBypassed: display-only effects run as passthrough while true. */
    public int setDisplayBypass(boolean bypass) { return displayBypass(handle, bypass); }
    public int setParameters(int instance, float[] values, int hash) { return parameters(handle, instance, values, hash); }
    public int setParameterBytes(int instance, byte[] values, int hash) { return parameterBytes(handle, instance, values, hash); }
    public int setAsset(int instance, int slot, int[] info, byte[] bytes, int format) {
        return asset(handle, instance, slot, info, bytes, format, -1, 0);
    }
    int setAsset(int instance, int slot, int[] info, byte[] bytes, int format, long revision) {
        return asset(handle, instance, slot, info, bytes, format, revision, 0);
    }
    public int setAssetFile(int instance, int slot, int[] info, int fd, long byteSize, int format) {
        return setAssetFile(instance, slot, info, fd, byteSize, format, -1);
    }
    public int setAssetFile(int instance, int slot, int[] info, int fd, long byteSize, int format, long token) {
        return setAssetFile(instance, slot, info, fd, byteSize, format, token, 0);
    }
    public int setAssetFile(int instance, int slot, int[] info, int fd, long byteSize, int format, long token, int branch) {
        return assetFile(handle, instance, slot, info, fd, byteSize, format, token, branch);
    }
    public int clearAsset(int instance, int slot) {
        return clearAsset(instance, slot, 0);
    }
    public int clearAsset(int instance, int slot, int branch) { return asset(handle, instance, slot, new int[10], new byte[0], 0, -1, branch); }
    /** Channels holds a left and right device channel index per source. */
    public int setVisualizerSources(String[] types, float[][] parameters, int[] taps, int[] hashes, int[] channels, float[] gains) {
        return visualizerSources(handle, types, parameters, taps, hashes, channels, gains);
    }
    /** Repeated plugin ID, generation, latched flag, cause code. */
    public int[] readRuntimeEvents() { return runtimeEvents(handle); }
    /** CPU percentage (negative when not yet measured) and pipeline latency in samples. */
    public double[] readPipelineStats() { return pipelineStats(handle); }
    /** Graph test tone; a frequency of zero releases it. */
    public void setFrequencyPreview(double frequency, boolean noise) { frequencyPreview(handle, frequency, noise); }
    public int resetPlugin(int instance) { return resetPlugin(handle, instance); }
    /** Applies a SoundFont Player channel mix (mix >= 0) or control messages; returns the applied frame or a negative status. */
    public long soundFontMixerAction(int instance, int channel, int mix, int[] messages) {
        return soundFontMixerAction(handle, instance, channel, mix, messages);
    }
    public double[] sfzPreparationContext(int instance) {
        return sfzPreparationContext(instance, 0);
    }
    public double[] sfzPreparationContext(int instance, int branch) { return sfzPreparationContext(handle, instance, branch); }
    public int setMidiMetering(int instance, boolean enabled) {
        return setMidiMetering(instance, enabled, 0);
    }
    public int setMidiMetering(int instance, boolean enabled, int branch) { return setMidiMetering(handle, instance, enabled, branch); }
    /** Repeated plugin ID, generation, submission token and flags (1 needs poll, 2 awaits resident pages). */
    public long[] sampleStreams() {
        return sampleStreams(0);
    }
    public long[] sampleStreams(int branch) { return sampleStreams(handle, branch); }
    /** Empty on failure, {0} during preparation, or a readiness header followed by request triples. */
    public long[] pollSamplePages(int instance, long generation, long token) {
        return pollSamplePages(instance, generation, token, 0);
    }
    public long[] pollSamplePages(int instance, long generation, long token, int branch) {
        return pollSamplePages(handle, instance, generation, token, branch);
    }
    public int publishSamplePage(int instance, long generation, long token, int sample, long page,
                                 float[] pcm, int frames, int channels, boolean resident) {
        return publishSamplePage(instance, generation, token, sample, page, pcm, frames, channels, resident, 0);
    }
    public int publishSamplePage(int instance, long generation, long token, int sample, long page,
                                 float[] pcm, int frames, int channels, boolean resident, int branch) {
        return publishSamplePage(handle, instance, generation, token, sample, page, pcm, frames, channels, resident, branch);
    }
    public int failSampleStream(int instance, long generation, long token) {
        return failSampleStream(instance, generation, token, 0);
    }
    public int failSampleStream(int instance, long generation, long token, int branch) {
        return failSampleStream(handle, instance, generation, token, branch);
    }
    /** Repeated plugin ID, slot, asset state, rejected flag, request token, and completion flag. */
    public int[] readAssetNotices() {
        return readAssetNotices(0);
    }
    public int[] readAssetNotices(int branch) { return assetNotices(handle, branch); }
    int assetState(int instance, int slot, int branch) { return assetState(handle, instance, slot, branch); }
    public void setMasterBypass(boolean value) { bypass(handle, value); }
    public long beginSource() { return beginSource(handle); }
    double scoreTransport(int fd, double seconds, double speed, boolean play) { return scoreTransport(handle, fd, seconds, speed, play); }
    double scorePosition() { return scorePosition(handle); }
    double pauseScore() { return pauseScore(handle); }
    void scoreSpeed(double speed) { scoreSpeed(handle, speed); }
    boolean takeScoreEnded() { return takeScoreEnded(handle); }
    int liveMidiSource(boolean enabled) { return liveMidiSource(handle, enabled); }
    int liveMidiEvent(int message, int note, int flags, int[] state, double delay) {
        return liveMidiEvent(handle, message, note, flags, state, delay);
    }
    public int writePcm(float[] data, int frames, long generation) { return writePcm(handle, data, frames, generation); }
    public int getQueuedFrames() { return queuedFrames(handle); }
    public long getRenderedFrames() { return renderedFrames(handle); }
    public void setPlaying(boolean value) { playing(handle, value); }
    public void setGain(float value) { gain(handle, value); }
    public void setPlayerGain(float value) { playerGain(handle, value); }
    public void beginMeasurementFiles(int excitationFd, int resultFd, int excitationFrames, int captureFrames,
                                      float overloadPeak, int overloadTailFrames, int inputChannel) {
        beginMeasurementFiles(handle, excitationFd, resultFd, excitationFrames, captureFrames,
                overloadPeak, overloadTailFrames, inputChannel);
    }
    public void cancelMeasurement() { cancelMeasurement(handle); }
    public int[] getMeasurementState() { return measurementState(handle); }
    public void setPowerSettings(float threshold, float monitoringSeconds, boolean mustProcess) {
        powerSettings(handle, threshold, monitoringSeconds, mustProcess);
    }
    /** Sequence, input peak, output peak, silent seconds, monitoring flag. */
    public float[] getPowerObservation() { return powerObservation(handle); }
    /** Largest input peak since the previous call; only the level meter reads it. */
    public float getMeterLevel() { return meterLevel(handle); }
    public long getAudioFrameTime() { return audioFrameTime(handle); }
    public int setSpectrumTap(int id, boolean enabled, boolean compare, boolean hq) {
        return spectrumTap(handle, id, enabled, compare, hq);
    }
    public int setSpectrumTapRoute(int id, boolean enabled) { return spectrumTapRoute(handle, id, enabled); }
    /** Packed Spectrum overlay frames; see packSpectrumFrame in native_engine.cpp. */
    public byte[] drainSpectrum() { return drainSpectrum(handle); }
    /** Telemetry packets, each a 40-byte header and its payload; see NativeEngine::telemetryPackets. */
    public byte[] readTelemetryPackets() { return telemetryPackets(handle); }
    /** Pipeline frame, its steady-clock time in ns and the output latency in frames; empty when unknown. */
    public double[] getVisualClock() { return visualClock(handle); }
    public int setVisualSync(boolean enabled) { return visualSync(handle, enabled); }
    /** Returns the clamped delay target or a negative status. */
    public int setVisualSyncDelay(int samples) { return visualSyncDelay(handle, samples); }
    public int getAppliedOutputDelay() { return appliedOutputDelay(handle); }
    public int scheduleParameters(int instance, float[] values, int hash, long frame) {
        return scheduleParameters(handle, instance, values, hash, frame);
    }
    private static native long create(int sampleRate, int maxFrames, int channels);
    private static native long[] runBenchmark(long handle, byte[] input, int channels, int warmupBlocks, long durationNs);
    private static native void destroy(long handle);
    private static native int start(long handle);
    private static native int outputStatus(long handle);
    private static native int inputSessionId(long handle);
    private static native void stop(long handle);
    private static native void prepareResume(long handle);
    private static native int sampleRate(long handle);
    private static native int outputDeviceId(long handle);
    private static native int outputDevice(long handle, int deviceId);
    private static native int latency(long handle, int mode);
    private static native int output(long handle, int deviceId, int mode);
    private static native int[] observeOutput(long handle);
    private static native void measurementNoiseFile(long handle, int fd, int frames);
    private static native void stopMeasurementNoise(long handle);
    private static native void measurementMeter(long handle, int channel);
    private static native int inputDevice(long handle, int deviceId);
    private static native int[] configure(long handle, String[] types, float[][] parameters, int[] hashes, int[] ids, byte[] descriptor, byte[][] structured, byte[] flags);
    private static native int takeOverload(long handle);
    private static native int displayBypass(long handle, boolean bypass);
    private static native int parameters(long handle, int instance, float[] values, int hash);
    private static native int parameterBytes(long handle, int instance, byte[] values, int hash);
    private static native int asset(long handle, int instance, int slot, int[] info, byte[] bytes, int format, long operationRevision, int branch);
    private static native int assetFile(long handle, int instance, int slot, int[] info, int fd, long byteSize, int format, long token, int branch);
    private static native int visualizerSources(long handle, String[] types, float[][] parameters, int[] taps, int[] hashes, int[] channels, float[] gains);
    private static native int[] runtimeEvents(long handle);
    private static native double[] pipelineStats(long handle);
    private static native void frequencyPreview(long handle, double frequency, boolean noise);
    private static native int resetPlugin(long handle, int instance);
    private static native long soundFontMixerAction(long handle, int instance, int channel, int mix, int[] messages);
    private static native double[] sfzPreparationContext(long handle, int instance, int branch);
    private static native int setMidiMetering(long handle, int instance, boolean enabled, int branch);
    private static native long[] sampleStreams(long handle, int branch);
    private static native long[] pollSamplePages(long handle, int instance, long generation, long token, int branch);
    private static native int publishSamplePage(long handle, int instance, long generation, long token,
                                                int sample, long page, float[] pcm, int frames, int channels, boolean resident, int branch);
    private static native int failSampleStream(long handle, int instance, long generation, long token, int branch);
    private static native int[] assetNotices(long handle, int branch);
    private static native int assetState(long handle, int instance, int slot, int branch);
    private static native void bypass(long handle, boolean value);
    private static native long beginSource(long handle);
    private static native double scoreTransport(long handle, int fd, double seconds, double speed, boolean play);
    private static native double scorePosition(long handle);
    private static native double pauseScore(long handle);
    private static native void scoreSpeed(long handle, double speed);
    private static native boolean takeScoreEnded(long handle);
    private static native int liveMidiSource(long handle, boolean enabled);
    private static native int liveMidiEvent(long handle, int message, int note, int flags, int[] state, double delay);
    private static native int writePcm(long handle, float[] data, int frames, long generation);
    private static native int queuedFrames(long handle);
    private static native long renderedFrames(long handle);
    private static native void playing(long handle, boolean value);
    private static native void gain(long handle, float value);
    private static native void playerGain(long handle, float value);
    private static native void beginMeasurementFiles(long handle, int excitationFd, int resultFd, int excitationFrames, int captureFrames,
                                                     float overloadPeak, int overloadTailFrames, int inputChannel);
    private static native void cancelMeasurement(long handle);
    private static native int[] measurementState(long handle);
    private static native void powerSettings(long handle, float threshold, float monitoringSeconds, boolean mustProcess);
    private static native float[] powerObservation(long handle);
    private static native float meterLevel(long handle);
    private static native long audioFrameTime(long handle);
    private static native int spectrumTap(long handle, int id, boolean enabled, boolean compare, boolean hq);
    private static native int spectrumTapRoute(long handle, int id, boolean enabled);
    private static native byte[] drainSpectrum(long handle);
    private static native byte[] telemetryPackets(long handle);
    private static native double[] visualClock(long handle);
    private static native int visualSync(long handle, boolean enabled);
    private static native int visualSyncDelay(long handle, int samples);
    private static native int appliedOutputDelay(long handle);
    private static native int scheduleParameters(long handle, int instance, float[] values, int hash, long frame);
}

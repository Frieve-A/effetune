package com.frieve.effetune;

import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.media.audiofx.AudioEffect;
import android.os.Handler;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.IntSupplier;

/** Observes only the native input session; all methods run on the Service control Handler. */
final class RecordingMonitor implements AutoCloseable {
    private final AudioManager manager;
    private final IntSupplier session;
    private final Runnable invalidated;
    private State baseline;
    private final AudioManager.AudioRecordingCallback callback = new AudioManager.AudioRecordingCallback() {
        @Override public void onRecordingConfigChanged(List<AudioRecordingConfiguration> configs) {
            if (baseline != null) accept(find(configs, baseline.session));
        }
    };

    RecordingMonitor(AudioManager manager, Handler handler, IntSupplier session, Runnable invalidated) {
        this.manager = manager; this.session = session; this.invalidated = invalidated;
        manager.registerAudioRecordingCallback(callback, handler);
    }

    boolean arm() {
        baseline = null;
        int current = session.getAsInt();
        State state = current > 0 ? find(manager.getActiveRecordingConfigurations(), current) : null;
        if (state == null || state.silenced) return false;
        baseline = state;
        return true;
    }

    void disarm() { baseline = null; }
    @Override public void close() { disarm(); manager.unregisterAudioRecordingCallback(callback); }

    // A compact immutable snapshot also lets the test exercise policy changes
    // that emulators cannot induce through physical recording arbitration.
    static final class State {
        final int session;
        final boolean silenced;
        final String conditions;
        State(int session, boolean silenced, String conditions) {
            this.session = session; this.silenced = silenced; this.conditions = conditions;
        }
    }

    void accept(State current) {
        if (baseline == null) return;
        if (current == null || current.session != baseline.session || current.silenced
                || !current.conditions.equals(baseline.conditions)) {
            baseline = null;
            invalidated.run();
        }
    }

    static State find(List<AudioRecordingConfiguration> configs, int session) {
        for (AudioRecordingConfiguration config : configs) {
            if (config.getClientAudioSessionId() != session) continue;
            String conditions = format(config.getFormat()) + "/" + format(config.getClientFormat())
                    + "/" + (config.getAudioDevice() == null ? 0 : config.getAudioDevice().getId())
                    + "/" + config.getAudioSource() + "/" + config.getClientAudioSource()
                    + "/" + effects(config.getEffects()) + "/" + effects(config.getClientEffects());
            return new State(session, config.isClientSilenced(), conditions);
        }
        return null;
    }

    private static String format(AudioFormat value) {
        return value.getSampleRate() + ":" + value.getEncoding() + ":" + value.getChannelMask()
                + ":" + value.getChannelIndexMask();
    }

    private static String effects(List<AudioEffect.Descriptor> descriptors) {
        ArrayList<String> values = new ArrayList<>();
        for (AudioEffect.Descriptor descriptor : descriptors) values.add(descriptor.type + ":" + descriptor.uuid);
        Collections.sort(values);
        return String.join(",", values);
    }
}

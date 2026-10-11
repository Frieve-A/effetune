// Parameter descriptions for the remote `describeEffects` op, for keys that neither a
// standard PluginBase control nor the generated DSP catalog describes (graphs, hand-built
// widgets, JS-only effects). Keyed by plugin class name, then by short key; each entry has
// the shape of a describeEffects `params` entry (docs/remote-v1.md). The ranges follow what
// each effect's setParameters() clamps to; tests/esm/remote-describe-real-app-electron-browser.test.mjs
// fails when a key of any effect is left undescribed or a range here stops matching.
// Kept out of the plugin files so that editing a description does not change the plugin
// source hashes the DSP parity goldens record.

export const PARAMETER_HINTS = Object.freeze({
    BassManagementPlugin: Object.freeze({
        ro: { items: { control: 'select', label: 'Role', options: [{ value: 0, label: 'Full Range' }, { value: 1, label: 'Managed' }, { value: 2, label: 'LFE' }, { value: 3, label: 'Unused' }] }, description: 'One role per input channel (16 entries, Ch 1 first).' },
        fc: { items: { control: 'number', label: 'Crossover Frequency', min: 20, max: 300, step: 1, unit: 'Hz', scale: 'log', integer: true }, description: 'Crossover frequency of each managed input channel (16 entries).' },
        sl: { items: { control: 'select', label: 'Crossover Slope', options: [{ value: 24, label: '24dB' }, { value: 48, label: '48dB' }, { value: 96, label: '96dB' }] }, description: 'Crossover slope of each managed input channel (16 entries).' },
        rt: { items: { control: 'number', label: 'Sub Routing Mask', min: 0, max: 65535, step: 1, unit: '', scale: 'linear', integer: true }, description: 'Per input channel, a bit mask of subwoofer outputs it feeds: bit n is output Ch n+1, which must also be set in su.' },
        ri: { items: { control: 'number', label: 'Sub Polarity Inversion Mask', min: 0, max: 65535, step: 1, unit: '', scale: 'linear', integer: true }, description: 'Per input channel, the bits of rt whose subwoofer feed is polarity inverted; bits not in rt are cleared.' },
        su: { control: 'number', label: 'Subwoofer Outputs Mask', min: 0, max: 65535, step: 1, unit: '', scale: 'linear', integer: true, description: 'Bit mask of output channels used as subwoofers (bit n is Ch n+1); 0 turns bass management off.' },
        ch: { control: 'select', label: 'Channel', options: [{ value: 'A', label: 'All' }], description: 'Bass Management always processes all channels.' }
    }),
    BrickwallLimiterPlugin: Object.freeze({
        os: { control: 'select', label: 'Oversampling', options: [{ value: 1, label: '1x' }, { value: 2, label: '2x' }, { value: 4, label: '4x' }, { value: 8, label: '8x' }], description: 'Any other value rejects the whole parameter update.' },
        pluginType: { format: 'internal', label: 'Plugin Type', description: 'Always "BrickwallLimiterPlugin"; written by the effect for identification and ignored when set.' }
    }),
    CrosstalkCancellationPlugin: Object.freeze({
        ll: { format: 'measurement-channel-id', label: 'L Speaker → Left Ear', description: 'A saved measurement channel id "<measurement id>::ch=<channel>" from the app\'s measurement store (at most 160 characters), or "" when unassigned; ll/rl and lr/rr each take two channels of one measurement.' },
        lr: { format: 'measurement-channel-id', label: 'L Speaker → Right Ear', description: 'A saved measurement channel id "<measurement id>::ch=<channel>" from the app\'s measurement store (at most 160 characters), or "" when unassigned; ll/rl and lr/rr each take two channels of one measurement.' },
        rl: { format: 'measurement-channel-id', label: 'R Speaker → Left Ear', description: 'A saved measurement channel id "<measurement id>::ch=<channel>" from the app\'s measurement store (at most 160 characters), or "" when unassigned; ll/rl and lr/rr each take two channels of one measurement.' },
        rr: { format: 'measurement-channel-id', label: 'R Speaker → Right Ear', description: 'A saved measurement channel id "<measurement id>::ch=<channel>" from the app\'s measurement store (at most 160 characters), or "" when unassigned; ll/rl and lr/rr each take two channels of one measurement.' },
        fd: { format: 'internal', label: 'Filter Delay', description: 'Always Taps / 2 in samples; derived by the effect and ignored when set.' }
    }),
    FIRCrossoverPlugin: Object.freeze({
        bc: { control: 'select', label: 'Band Count', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }], description: 'Limited to half the output channel count (at most 4).' },
        f1: { control: 'number', label: 'Freq 1', min: 10, max: 40000, step: 1, unit: 'Hz', scale: 'log', description: 'Active crossover frequencies are kept in ascending order, at least 1 Hz apart.' },
        s1: { control: 'select', label: 'Slope 1', options: [{ value: -24, label: '24dB' }, { value: -48, label: '48dB' }, { value: -72, label: '72dB' }, { value: -96, label: '96dB' }, { value: -144, label: '144dB' }, { value: -192, label: '192dB' }, { value: -288, label: '288dB' }, { value: -384, label: '384dB' }] },
        f2: { control: 'number', label: 'Freq 2', min: 10, max: 40000, step: 1, unit: 'Hz', scale: 'log', description: 'Active crossover frequencies are kept in ascending order, at least 1 Hz apart.' },
        s2: { control: 'select', label: 'Slope 2', options: [{ value: -24, label: '24dB' }, { value: -48, label: '48dB' }, { value: -72, label: '72dB' }, { value: -96, label: '96dB' }, { value: -144, label: '144dB' }, { value: -192, label: '192dB' }, { value: -288, label: '288dB' }, { value: -384, label: '384dB' }] },
        f3: { control: 'number', label: 'Freq 3', min: 10, max: 40000, step: 1, unit: 'Hz', scale: 'log', description: 'Active crossover frequencies are kept in ascending order, at least 1 Hz apart.' },
        s3: { control: 'select', label: 'Slope 3', options: [{ value: -24, label: '24dB' }, { value: -48, label: '48dB' }, { value: -72, label: '72dB' }, { value: -96, label: '96dB' }, { value: -144, label: '144dB' }, { value: -192, label: '192dB' }, { value: -288, label: '288dB' }, { value: -384, label: '384dB' }] }
    }),
    FiveBandFIRPEQPlugin: Object.freeze({
        fd: { format: 'internal', label: 'FIR Delay', description: 'Computed from the phase mode and taps (0 or taps / 2 samples); values sent are ignored.' },
        dy: { format: 'internal', label: 'Delay', description: 'Always 0; values sent are ignored.' },
        gn: { format: 'internal', label: 'Gain', description: 'Always 0; values sent are ignored.' },
        f0: { control: 'number', label: 'Band 1 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        g0: { control: 'number', label: 'Band 1 Gain', min: -20, max: 20, step: 0.1, unit: 'dB', scale: 'linear' },
        q0: { control: 'number', label: 'Band 1 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        s0: { control: 'number', label: 'Band 1 Slope', min: 0.1, max: 384, step: 0.1, unit: 'dB/oct', scale: 'log' },
        t0: { control: 'select', label: 'Band 1 Type', options: [{ value: 'pk', label: 'Peaking' }, { value: 'lp', label: 'LowPass' }, { value: 'hp', label: 'HighPass' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'bp', label: 'BandPass' }, { value: 'no', label: 'Notch' }] },
        e0: { control: 'checkbox', label: 'Band 1 Enabled' },
        f1: { control: 'number', label: 'Band 2 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        g1: { control: 'number', label: 'Band 2 Gain', min: -20, max: 20, step: 0.1, unit: 'dB', scale: 'linear' },
        q1: { control: 'number', label: 'Band 2 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        s1: { control: 'number', label: 'Band 2 Slope', min: 0.1, max: 384, step: 0.1, unit: 'dB/oct', scale: 'log' },
        t1: { control: 'select', label: 'Band 2 Type', options: [{ value: 'pk', label: 'Peaking' }, { value: 'lp', label: 'LowPass' }, { value: 'hp', label: 'HighPass' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'bp', label: 'BandPass' }, { value: 'no', label: 'Notch' }] },
        e1: { control: 'checkbox', label: 'Band 2 Enabled' },
        f2: { control: 'number', label: 'Band 3 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        g2: { control: 'number', label: 'Band 3 Gain', min: -20, max: 20, step: 0.1, unit: 'dB', scale: 'linear' },
        q2: { control: 'number', label: 'Band 3 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        s2: { control: 'number', label: 'Band 3 Slope', min: 0.1, max: 384, step: 0.1, unit: 'dB/oct', scale: 'log' },
        t2: { control: 'select', label: 'Band 3 Type', options: [{ value: 'pk', label: 'Peaking' }, { value: 'lp', label: 'LowPass' }, { value: 'hp', label: 'HighPass' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'bp', label: 'BandPass' }, { value: 'no', label: 'Notch' }] },
        e2: { control: 'checkbox', label: 'Band 3 Enabled' },
        f3: { control: 'number', label: 'Band 4 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        g3: { control: 'number', label: 'Band 4 Gain', min: -20, max: 20, step: 0.1, unit: 'dB', scale: 'linear' },
        q3: { control: 'number', label: 'Band 4 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        s3: { control: 'number', label: 'Band 4 Slope', min: 0.1, max: 384, step: 0.1, unit: 'dB/oct', scale: 'log' },
        t3: { control: 'select', label: 'Band 4 Type', options: [{ value: 'pk', label: 'Peaking' }, { value: 'lp', label: 'LowPass' }, { value: 'hp', label: 'HighPass' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'bp', label: 'BandPass' }, { value: 'no', label: 'Notch' }] },
        e3: { control: 'checkbox', label: 'Band 4 Enabled' },
        f4: { control: 'number', label: 'Band 5 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        g4: { control: 'number', label: 'Band 5 Gain', min: -20, max: 20, step: 0.1, unit: 'dB', scale: 'linear' },
        q4: { control: 'number', label: 'Band 5 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        s4: { control: 'number', label: 'Band 5 Slope', min: 0.1, max: 384, step: 0.1, unit: 'dB/oct', scale: 'log' },
        t4: { control: 'select', label: 'Band 5 Type', options: [{ value: 'pk', label: 'Peaking' }, { value: 'lp', label: 'LowPass' }, { value: 'hp', label: 'HighPass' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'bp', label: 'BandPass' }, { value: 'no', label: 'Notch' }] },
        e4: { control: 'checkbox', label: 'Band 5 Enabled' }
    }),
    GroupDelayEqPlugin: Object.freeze({
        d0: { control: 'number', label: '25 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d1: { control: 'number', label: '40 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d2: { control: 'number', label: '63 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d3: { control: 'number', label: '100 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d4: { control: 'number', label: '160 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d5: { control: 'number', label: '250 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d6: { control: 'number', label: '400 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d7: { control: 'number', label: '630 Hz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d8: { control: 'number', label: '1.0 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d9: { control: 'number', label: '1.6 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d10: { control: 'number', label: '2.5 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d11: { control: 'number', label: '4.0 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d12: { control: 'number', label: '6.3 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d13: { control: 'number', label: '10 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        d14: { control: 'number', label: '16 kHz Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' }
    }),
    GroupDelayPEQPlugin: Object.freeze({
        t0: { control: 'select', label: 'Band 1 Type', options: [{ value: 'pk', label: 'Peak' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'fl', label: 'FilterGD' }] },
        f0: { control: 'number', label: 'Band 1 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        d0: { control: 'number', label: 'Band 1 Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        q0: { control: 'number', label: 'Band 1 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        e0: { control: 'checkbox', label: 'Band 1 Enabled' },
        t1: { control: 'select', label: 'Band 2 Type', options: [{ value: 'pk', label: 'Peak' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'fl', label: 'FilterGD' }] },
        f1: { control: 'number', label: 'Band 2 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        d1: { control: 'number', label: 'Band 2 Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        q1: { control: 'number', label: 'Band 2 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        e1: { control: 'checkbox', label: 'Band 2 Enabled' },
        t2: { control: 'select', label: 'Band 3 Type', options: [{ value: 'pk', label: 'Peak' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'fl', label: 'FilterGD' }] },
        f2: { control: 'number', label: 'Band 3 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        d2: { control: 'number', label: 'Band 3 Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        q2: { control: 'number', label: 'Band 3 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        e2: { control: 'checkbox', label: 'Band 3 Enabled' },
        t3: { control: 'select', label: 'Band 4 Type', options: [{ value: 'pk', label: 'Peak' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'fl', label: 'FilterGD' }] },
        f3: { control: 'number', label: 'Band 4 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        d3: { control: 'number', label: 'Band 4 Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        q3: { control: 'number', label: 'Band 4 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        e3: { control: 'checkbox', label: 'Band 4 Enabled' },
        t4: { control: 'select', label: 'Band 5 Type', options: [{ value: 'pk', label: 'Peak' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }, { value: 'fl', label: 'FilterGD' }] },
        f4: { control: 'number', label: 'Band 5 Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' },
        d4: { control: 'number', label: 'Band 5 Delay', min: -149.3, max: 149.3, step: 0.1, unit: 'ms', scale: 'linear', description: 'Clamped to +/- floor((tp * 7 / 16) / sampleRate * 10000) / 10 ms, which depends on the taps (tp) and the sample rate.' },
        q4: { control: 'number', label: 'Band 5 Q', min: 0.1, max: 100, step: 0.01, unit: '', scale: 'log' },
        e4: { control: 'checkbox', label: 'Band 5 Enabled' }
    }),
    IRReverbPlugin: Object.freeze({
        ir: { format: 'ir-id', label: 'Impulse Response', description: 'IR library id: 24 lowercase hex characters (see listIRs), or "" for none; anything else is stored as "".' }
    }),
    MatrixPlugin: Object.freeze({
        mx: { format: 'routing', label: 'Matrix Routing', description: 'Concatenated routes, each two lowercase hex digits <input><output> (channel 0-f, 0 = Ch 1) with an optional "p" prefix for phase inversion, e.g. "0011" is L->L and R->R and "p01" is L->R inverted; "" mutes all outputs.' }
    }),
    ModalResonatorPlugin: Object.freeze({
        sr: { control: 'select', label: 'Selected Resonator', options: [{ value: 0, label: 'Resonator 1' }, { value: 1, label: 'Resonator 2' }, { value: 2, label: 'Resonator 3' }, { value: 3, label: 'Resonator 4' }, { value: 4, label: 'Resonator 5' }], description: 'The resonator tab shown in the UI; it does not change the sound.' }
    }),
    MultiChannelPanelPlugin: Object.freeze({
        l: { items: { control: 'checkbox', label: 'Link' }, description: 'Entry i links Ch i+1 to Ch i+2 (7 entries for 8 channels, 15 for 16); linked channels share mute, solo, volume and delay. A given array replaces all links.' }
    }),
    MultibandBalancePlugin: Object.freeze({
        f4: { control: 'number', label: 'Freq 4', min: 1000, max: 20000, step: 1, unit: 'Hz', scale: 'linear', minKey: 'f3', description: 'Highest crossover; clamped to max(Freq 3, 1000)..20000 Hz.' }
    }),
    MultibandCompressorPlugin: Object.freeze({
        f4: { control: 'number', label: 'Freq 4', min: 1000, max: 20000, step: 1, unit: 'Hz', scale: 'linear', minKey: 'f3', description: 'Highest crossover; clamped to max(Freq 3, 1000)..20000 Hz.' }
    }),
    MultibandExpanderPlugin: Object.freeze({
        f4: { control: 'number', label: 'Freq 4', min: 1000, max: 20000, step: 1, unit: 'Hz', scale: 'linear', minKey: 'f3', description: 'Highest crossover; clamped to max(Freq 3, 1000)..20000 Hz.' }
    }),
    NoteSpectrogramPlugin: Object.freeze({
        mn: { control: 'number', label: 'Lowest Note', min: 21, max: 108, step: 1, unit: 'MIDI note', scale: 'linear', integer: true },
        mx: { control: 'number', label: 'Highest Note', min: 21, max: 108, step: 1, unit: 'MIDI note', scale: 'linear', integer: true }
    }),
    OscillatorPlugin: Object.freeze({
        wf: { control: 'select', label: 'Waveform Type', options: [{ value: 'sine', label: 'Sine' }, { value: 'sawtooth', label: 'Sawtooth' }, { value: 'triangle', label: 'Triangle' }, { value: 'square', label: 'Square' }, { value: 'impulse', label: 'Impulse' }, { value: 'white', label: 'White Noise' }, { value: 'pink', label: 'Pink Noise' }] }
    }),
    OscilloscopePlugin: Object.freeze({
        dt: { control: 'number', label: 'Display Time', min: 0.001, max: 0.1, step: 0.001, unit: 's', scale: 'log' },
        tm: { control: 'select', label: 'Trigger Mode', options: [{ value: 'Auto', label: 'Auto' }, { value: 'Normal', label: 'Normal' }, { value: 'Off', label: 'Off' }] },
        tl: { control: 'number', label: 'Trigger Level', min: -1, max: 1, step: 0.01, unit: '', scale: 'linear' },
        te: { control: 'select', label: 'Trigger Edge', options: [{ value: 'Rising', label: 'Rising' }, { value: 'Falling', label: 'Falling' }] },
        ho: { control: 'number', label: 'Holdoff', min: 0.0001, max: 0.01, step: 0.0001, unit: 's', scale: 'log' },
        dl: { control: 'number', label: 'Display Level', min: -96, max: 0, step: 1, unit: 'dB', scale: 'linear' },
        vo: { control: 'number', label: 'Vertical Offset', min: -1, max: 1, step: 0.01, unit: '', scale: 'linear' }
    }),
    PitchMeterPlugin: Object.freeze({
        mn: { control: 'number', label: 'Lowest Note', min: 21, max: 108, step: 1, unit: 'MIDI note', scale: 'linear', integer: true },
        mx: { control: 'number', label: 'Highest Note', min: 21, max: 108, step: 1, unit: 'MIDI note', scale: 'linear', integer: true }
    }),
    RoomEqPlugin: Object.freeze({
        pa: { control: 'checkbox', label: 'Phase Low Auto', description: 'When on, Phase Low follows the design automatically.' },
        pl: { control: 'number', label: 'Phase Low', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'log', integer: true, description: 'Rounded; with Phase Low Auto off it is at least max(20, ceil(1000 / dw)) Hz.' },
        pq: { control: 'checkbox', label: 'Phase Smoothing Auto', description: 'When on, Phase Smoothing follows the magnitude smoothing (sm).' },
        ps: { control: 'number', label: 'Phase Smoothing', min: 0.02, max: 1, step: 0.01, unit: 'oct', scale: 'linear' },
        rp: { control: 'number', label: 'Reference Point', min: 0, step: 1, unit: '', scale: 'linear', integer: true, description: 'Index of the reference point of the selected measurement; 0 when the measurement has no such point.' },
        bs: { members: { frequency: { control: 'number', label: 'Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'linear' }, gain: { control: 'number', label: 'Gain', min: -20, max: 20, step: 0.1, unit: 'dB', scale: 'linear' }, q: { control: 'number', label: 'Q', min: 0.1, max: 10, step: 0.01, unit: '', scale: 'linear', description: 'The editor limits Q to 2 for ls and hs bands; the effect accepts up to 10.' }, type: { control: 'select', label: 'Type', options: [{ value: 'pk', label: 'Peaking' }, { value: 'ls', label: 'LowShelv' }, { value: 'hs', label: 'HighShel' }] }, enabled: { control: 'checkbox', label: 'Enabled' } }, description: 'Five additional EQ bands; send all five objects.' },
        ms: { format: 'measurement-id', label: 'Measurement', description: 'Id of a stored room measurement (at most 160 characters), or an empty string for none.' },
        mn: { format: 'text', label: 'Measurement Name', description: 'Display name of the measurement in ms (at most 160 characters).' },
        dl: { control: 'number', label: 'Delay', min: 0, max: 20, step: 0.01, unit: 'ms', scale: 'linear' }
    }),
    SFZNotePlayerPlugin: Object.freeze({
        sf: { format: 'sfz-id', label: 'SFZ', description: 'Id (24 lowercase hex characters) of an instrument in the app\'s SFZ library, or an empty string for none.' },
        mn: { control: 'number', label: 'Lowest Note', min: 21, max: 108, step: 1, unit: 'MIDI note', scale: 'linear', integer: true },
        mx: { control: 'number', label: 'Highest Note', min: 21, max: 108, step: 1, unit: 'MIDI note', scale: 'linear', integer: true, minKey: 'mn', description: 'Raised to the Lowest Note when sent below it.' }
    }),
    SectionPlugin: Object.freeze({
        cm: { format: 'text', label: 'Section Name', description: 'Free text shown as the section name.' }
    }),
    SpatialMapperPlugin: Object.freeze({
        dm: { items: { control: 'number', label: 'Direct Gain', min: -1, max: 1, step: 0.01, unit: '', scale: 'linear' }, description: 'Direct routing matrix: 256 linear gains, row-major 16x16, entry out * 16 + in feeds output Ch out+1 from input component Ch in+1; missing entries are 0.' },
        fm: { items: { control: 'number', label: 'Diffuse Gain', min: -1, max: 1, step: 0.01, unit: '', scale: 'linear' }, description: 'Diffuse routing matrix: 256 linear gains, row-major 16x16, entry out * 16 + in feeds output Ch out+1 from input component Ch in+1; missing entries are 0.' },
        rm: { items: { control: 'number', label: 'Residual Gain', min: -1, max: 1, step: 0.01, unit: '', scale: 'linear' }, description: 'Residual routing matrix: 256 linear gains, row-major 16x16, entry out * 16 + in feeds output Ch out+1 from input component Ch in+1; missing entries are 0.' }
    }),
    SpectrogramPlugin: Object.freeze({
        pt: { control: 'number', label: 'Points', min: 8, max: 14, step: 1, unit: 'log2 FFT size', scale: 'linear', integer: true, description: 'FFT size exponent: the analysis uses 2^pt points (256 to 16384).' },
        hq: { control: 'checkbox', label: 'Log (HQ)', description: 'Mirrors sc === "log-hq"; ignored when sc is sent in the same change.' }
    }),
    SpectrumAnalyzerPlugin: Object.freeze({
        pt: { control: 'number', label: 'Points', min: 8, max: 14, step: 1, unit: 'log2 FFT size', scale: 'linear', integer: true, description: 'FFT size exponent: the analysis uses 2^pt points (256 to 16384).' },
        hq: { control: 'checkbox', label: 'Log (HQ)', description: 'Mirrors sc === "log-hq"; ignored when sc is sent in the same change.' }
    }),
    StereoMeterPlugin: Object.freeze({
        wt: { control: 'number', label: 'Window', min: 0.01, max: 1, step: 0.001, unit: 's', scale: 'log' },
        gn: { control: 'number', label: 'Gain', min: 0, max: 24, step: 1, unit: 'dB', scale: 'linear' }
    })
});

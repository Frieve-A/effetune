import { compileSfzEffects, packSfzEffects } from '../../js/sfz/effects.js';

export function generateSfzEffectsFixture() {
    const effect = opcodes => ({ name: 'effect', opcodes });
    const plan = compileSfzEffects([{ output: '1', effect1: '50' }], [
        effect({ type: 'comp', comp_ratio: '100', comp_gain_oncc7: '12', directtomain: '50' }),
        effect({ type: 'tdfir', bus: 'fx1', tdfir_impulse: 'impulse.wav', fx1tomix: '25' })
    ]);
    const dispatch = compileSfzEffects([], [
        { type: 'apan', apan_freq: '0', apan_phase: '90', apan_waveform: '1' },
        { type: 'comp', comp_attack: '0', comp_release: '0', comp_ratio: '2', comp_threshold: '-20' },
        { type: 'delay', delay_timel: '.002', delay_timec: '.002', delay_timer: '.002', delay_dry: '0' },
        { type: 'disto', disto_depth: '50', disto_stages: '2' },
        { type: 'eq', eq_freq: '1000', eq_gain: '6' },
        { type: 'filter', filter_type: 'lpf_1p', filter_cutoff: '500' },
        { type: 'fverb', reverb_predelay: '0', reverb_dry: '0', reverb_wet: '100', reverb_tone: '100' },
        { type: 'gate', gate_attack: '0', gate_release: '0', gate_threshold: '-20' },
        { type: 'limiter' }, { type: 'lofi', bitred: '100' },
        { type: 'phaser', phaser_waveform: '1' }, { type: 'static', static_level: '10' },
        { type: 'strings', strings_number: '12', strings_wet: '100' },
        { type: 'tdfir', tdfir_impulse: 'impulse.wav', tdfir_dry: '0' }
    ].map(effect));
    const array = (name, prepared, impulse) => {
        const bytes = packSfzEffects(prepared, () => ({ sampleOffsetOrId: impulse, frames: 1, channels: 2, rate: 48000 })),
            words = new Uint32Array(bytes.buffer);
        return `inline constexpr std::array<std::uint32_t, ${words.length}> ${name}{\n` +
            [...words].map(word => `  0x${word.toString(16).padStart(8, '0')}u,`).join('\n') + '\n};\n';
    };
    return '// Generated from tests/helpers/sfz-effects-fixture.mjs.\n#pragma once\n#include <array>\n#include <cstdint>\n' +
        '// clang-format off\n' + array('kSfzEffectsFixture', plan, 2) +
        array('kSfzEffectsDispatchFixture', dispatch, 0) +
        array('kSfzEffectsChorusFixture', compileSfzEffects([{ effect2: '100' }]), 0) +
        array('kSfzEffectsRuntimeFixture', compileSfzEffects([{ effect1: '50' }, { output: '1' }], [
            effect({ type: 'comp', comp_ratio: '1', comp_threshold: '0', comp_attack: '0', comp_release: '0',
                comp_gain_oncc7: '12', comp_gain_oncc142: '.1' }),
            effect({ type: 'delay', bus: 'fx1', delay_timel: '.001', delay_timec: '.001', delay_timer: '.001',
                delay_dry: '0', fx1tomain: '100' })]), 0) +
        array('kSfzEffectsSyncFixture', compileSfzEffects([{}], [effect({ type: 'delay',
            delay_syncl: '.001', delay_syncc: '.001', delay_syncr: '.001',
            delay_timel: '0', delay_timec: '0', delay_timer: '0', delay_dry: '0' })]), 0) +
        array('kSfzEffectsExtensionFixture', compileSfzEffects([], [
            effect({ type: 'gain', gain: '-6', gain_oncc7: '12' }),
            effect({ type: 'rectify', rectify: '0', rectify_oncc1: '100', rectify_mode: 'full' }),
            effect({ type: 'rectify', rectify: '100' }),
            effect({ type: 'filter', filter_type: 'peq', filter_cutoff: '1000', filter_gain_oncc2: '12' }),
            effect({ type: 'gate', gate_attack: '0', gate_release: '0', gate_threshold: '-20', gate_hold: '.01' })]), 0) +
        '// clang-format on\n';
}

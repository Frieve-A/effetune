// Independently authored SFZ effects profile. Public names and routing follow
// https://sfzformat.com/opcodes/type/; unspecified mappings are explicit here, rather
// than claiming equivalence to a proprietary effect implementation.
import { SFZ_MOD_FILTER_TYPES } from './modulation-schema.js';

export const SFZ_EFFECT_PROFILE = 'effetune-sfz-effects-v1';
export const SFZ_EFFECT_LAYOUT = Object.freeze({ Version: 1, HeaderWords: 22, RegionWords: 5,
    NodeWords: 8, RouteWords: 6, ImpulseWords: 4, MaximumNodes: 64, MaximumRoutes: 4096 });
export const SFZ_EFFECT_TYPES = Object.freeze({ apan: 1, comp: 2, delay: 3, disto: 4,
    eq: 5, filter: 6, fverb: 7, gate: 8, limiter: 9, lofi: 10, phaser: 11,
    static: 12, strings: 13, tdfir: 14, chorus: 15, gain: 16, rectify: 17 });
export const SFZ_EFFECT_BUS = Object.freeze({ main: 0,
    aux1: 1, aux2: 2, aux3: 3, aux4: 4, aux5: 5, aux6: 6, aux7: 7, aux8: 8,
    fx1: 9, fx2: 10, fx3: 11, fx4: 12 });
const scalar = (name, value, min, max, unit = 'scalar') => ({ name, default: value, min, max, unit });
const percent = (name, value = 100) => scalar(name, value, 0, 100, 'percent');
const seconds = (name, value, maximum = 10) => scalar(name, value, 0, maximum, 'seconds');
const hz = (name, value, maximum = 30000) => scalar(name, value, 0, maximum, 'Hz');
const db = (name, value) => scalar(name, value, -144, 24, 'dB');
const choice = (name, value, options) => ({ name, default: value, options });
const onoff = { off: 0, on: 1 };
const filterNames = { off: 0, ...SFZ_MOD_FILTER_TYPES };
const delayModes = Object.fromEntries(['stereo', 'cross', 'ping', 'lrc', 'rlc', 'tlcr', 'panning',
    'mod', 'multimod', 'chorus', 'flanger', 'detune'].map((name, index) => [name, index]));
const reverbTypes = Object.fromEntries(['chamber', 'small_room', 'mid_room', 'large_room',
    'small_hall', 'mid_hall', 'large_hall'].map((name, index) => [name, index]));

// Array order is the type-local parameter identity in the FX section.
export const SFZ_EFFECT_PARAMETERS = Object.freeze({
    apan: [percent('apan_depth'), percent('apan_dry', 0), hz('apan_freq', 1, 100),
        scalar('apan_phase', 0, 0, 180, 'degrees'), scalar('apan_waveform', 0, 0, 7, 'index'), percent('apan_wet')],
    comp: [seconds('comp_attack', .01), db('comp_gain', 0), scalar('comp_ratio', 2, 0, 100, 'ratio'),
        seconds('comp_release', .1), choice('comp_stlink', 1, onoff), db('comp_threshold', -24)],
    delay: [hz('delay_cutoff', 20000), percent('delay_damphi', 0), percent('delay_damplo', 0),
        percent('delay_dry'), percent('delay_feedback', 0), choice('delay_filter', 0, filterNames),
        percent('delay_input'), percent('delay_levelc', 0), percent('delay_levell'), percent('delay_levelr'),
        hz('delay_lfofreq', .5, 100), percent('delay_moddepth', 0), choice('delay_mode', 0, delayModes),
        percent('delay_panc', 50), percent('delay_panl', 0),
        percent('delay_panr', 100), scalar('delay_resonance', 0, 0, 40, 'dB'),
        percent('delay_spread'), scalar('delay_syncc', 0, 0, 64, 'quarter-notes'),
        scalar('delay_syncl', 0, 0, 64, 'quarter-notes'), scalar('delay_syncr', 0, 0, 64, 'quarter-notes'),
        seconds('delay_time_tap', 0), seconds('delay_timec', .25), seconds('delay_timel', .25),
        seconds('delay_timer', .25), percent('delay_wet')],
    disto: [percent('disto_depth', 0), percent('disto_dry', 0), scalar('disto_stages', 1, 1, 8, 'index'),
        percent('disto_tone', 100), percent('disto_wet')],
    eq: [scalar('eq_bw', 1, .001, 4, 'octaves'), hz('eq_freq', 1000), db('eq_gain', 0),
        choice('eq_type', 0, { peq: 0, lsh: 1, hsh: 2 })],
    filter: [hz('filter_cutoff', 20000), scalar('filter_resonance', 0, 0, 40, 'dB'),
        choice('filter_type', 2, filterNames), scalar('filter_gain', 0, -96, 96, 'dB')],
    fverb: [percent('reverb_damp', 50), percent('reverb_dry'), percent('reverb_input'),
        seconds('reverb_predelay', .01, 1), percent('reverb_size', 50), percent('reverb_tone', 50),
        choice('reverb_type', 0, reverbTypes), percent('reverb_wet', 30)],
    gate: [seconds('gate_attack', .001), seconds('gate_release', .2), choice('gate_stlink', 1, onoff),
        db('gate_threshold', -40), percent('gate', 100), seconds('gate_hold', 0)],
    limiter: [],
    lofi: [percent('bitred', 0), percent('decim', 0)],
    phaser: [percent('phaser_depth'), percent('phaser_feedback', 0),
        hz('phaser_freq', .5, 100), percent('phaser_phase', 0),
        scalar('phaser_stages', 4, 1, 12, 'index'), scalar('phaser_waveform', 0, 0, 7, 'index'), percent('phaser_wet', 50)],
    static: [percent('static_cyclic_level', 0), seconds('static_cyclic_time', 1, 120),
        choice('static_filter', 0, filterNames), percent('static_level', 0), percent('static_random_level', 0),
        seconds('static_random_maxtime', 1, 120), seconds('static_random_mintime', .1, 120),
        choice('static_stereo', 1, onoff), percent('static_tone', 50)],
    strings: [scalar('strings_number', 12, 1, 107, 'index'), percent('strings_wet', 50)],
    tdfir: [percent('tdfir_dry'), percent('tdfir_gain'), percent('tdfir_wet')],
    // Internal type for the v1 effect2 send; it is not an additional public alias.
    chorus: [],
    gain: [scalar('gain', 0, -144, 48, 'dB')],
    rectify: [percent('rectify', 0), choice('rectify_mode', 0, { half: 0, full: 1 })]
});
const routing = /^(?:directtomain|fx[1-4]to(?:main|mix))$/;
const regionRouting = /^(?:output|effect[1-4])$/;
const modulation = /^(.*)_(oncc|cc|curvecc|smoothcc|stepcc)([0-9]{1,3})$/;
const allParameters = new Set(Object.values(SFZ_EFFECT_PARAMETERS).flat().map(parameter => parameter.name));

export function isSfzEffectOpcode(key, header) {
    if (header !== 'effect') return regionRouting.test(key);
    const match = modulation.exec(key);
    return ['type', 'bus', 'tdfir_impulse'].includes(key) || routing.test(key) ||
        allParameters.has(match?.[1] ?? key) || /^bypass_oncc[0-9]{1,3}$/.test(key);
}

export function compileSfzEffects(regions, headers = []) {
    const diagnostics = [], nodes = [], direct = { directtomain: 100 };
    const fail = (code, opcode, index) => diagnostics.push({ code, opcode, index });
    const curveIds = new Set(headers.filter(header => header.name === 'curve').map(header => Number(header.opcodes.curve_index)));
    const numeric = (value, min, max, integer = false) => {
        if (typeof value === 'string' && !value.trim()) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isInteger(parsed)) ? parsed : null;
    };
    let requiredOutputs = 1;
    const compiledRegions = regions.map((region, index) => {
        const source = region.opcodes ?? region;
        const output = numeric(source.output ?? 0, 0, 1024, true);
        if (output === null) fail('effect-output', 'output', index);
        else requiredOutputs = Math.max(requiredOutputs, output + 1);
        const sends = Array.from({ length: 4 }, (_, send) => {
            const key = `effect${send + 1}`, value = numeric(source[key] ?? 0, 0, 100);
            if (value === null) fail('effect-send', key, index);
            return (value ?? 0) / 100;
        });
        return { output: output ?? 0, sends };
    });
    for (const [index, header] of headers.entries()) {
        if (header.name !== 'effect' && header.name !== 'midi') continue;
        const source = header.opcodes;
        if (header.name === 'midi' || source.bus === 'midi') {
            fail('effect-midi-profile', 'type', index); continue;
        }
        for (const [key, raw] of Object.entries(source)) if (routing.test(key)) {
            const value = numeric(raw, 0, 100);
            if (value === null) fail('effect-routing-gain', key, index);
            else direct[key] = value;
        }
        const name = source.type;
        if (name === undefined && Object.keys(source).every(key => routing.test(key))) continue;
        if (!Object.hasOwn(SFZ_EFFECT_TYPES, name) || name === 'chorus') {
            fail('effect-type', 'type', index); continue;
        }
        const bus = SFZ_EFFECT_BUS[source.bus ?? 'main'];
        if (bus === undefined) { fail('effect-bus', 'bus', index); continue; }
        if (bus > 0 && bus < 9) requiredOutputs = Math.max(requiredOutputs, bus + 1);
        const definitions = SFZ_EFFECT_PARAMETERS[name];
        const parameters = definitions.map(parameter => parameter.default);
        const routes = new Map();
        let bypassController = -1;
        for (const [key, raw] of Object.entries(source)) {
            if (['type', 'bus', 'tdfir_impulse'].includes(key) || routing.test(key)) continue;
            const bypass = /^bypass_oncc([0-9]{1,3})$/.exec(key);
            if (bypass) {
                const cc = Number(bypass[1]);
                if (cc > 155 || numeric(raw, 0, 1) === null) fail('effect-bypass', key, index);
                else if (Number(raw)) bypassController = cc;
                continue;
            }
            const match = modulation.exec(key), base = match?.[1] ?? key;
            const parameterIndex = definitions.findIndex(parameter => parameter.name === base);
            if (parameterIndex < 0) { fail('effect-parameter', key, index); continue; }
            const definition = definitions[parameterIndex];
            if (!match) {
                const value = definition.options ? definition.options[raw] :
                    numeric(raw, definition.min, definition.max, definition.unit === 'index');
                if (value === undefined || value === null) fail('effect-value', key, index);
                else parameters[parameterIndex] = value;
            } else {
                const controller = Number(match[3]), property = match[2];
                if (controller > 155 || definition.options || definition.unit === 'index') { fail('effect-modulation', key, index); continue; }
                const routeKey = `${parameterIndex}:${controller}`;
                const route = routes.get(routeKey) ?? { parameter: parameterIndex, controller, depth: 0, curve: 0, smooth: 0, step: 0 };
                const field = { oncc: 'depth', cc: 'depth', curvecc: 'curve', smoothcc: 'smooth', stepcc: 'step' }[property];
                const value = numeric(raw, field === 'depth' ? -3.4028234663852886e38 : 0,
                    field === 'curve' ? 255 : 3.4028234663852886e38, field === 'curve');
                if (value === null) fail('effect-modulation-value', key, index);
                else { route[field] = value; routes.set(routeKey, route); }
            }
        }
        if (name === 'tdfir' && !source.tdfir_impulse) fail('effect-impulse', 'tdfir_impulse', index);
        if (name === 'static' && parameters[5] < parameters[6]) fail('effect-time-order', 'static_random_maxtime', index);
        for (const route of routes.values()) {
            if (route.curve >= 4 && route.curve <= 6) fail('effect-curve-unverified', 'curve', index);
            else if (route.curve >= 7 && !curveIds.has(route.curve)) fail('effect-curve-missing', 'curve', index);
        }
        nodes.push({ type: SFZ_EFFECT_TYPES[name], bus, parameters, routes: [...routes.values()], bypassController,
            ...(name === 'tdfir' && { impulse: source.tdfir_impulse }) });
    }
    if (nodes.length > SFZ_EFFECT_LAYOUT.MaximumNodes) fail('effect-node-limit', 'type', nodes.length);
    if (nodes.reduce((count, node) => count + node.routes.length, 0) > SFZ_EFFECT_LAYOUT.MaximumRoutes)
        fail('effect-route-limit', 'modulation', nodes.length);
    // The original two SFZ v1 sends have defined effect roles without headers.
    if (!headers.some(header => header.name === 'effect')) {
        for (let send = 0; send < 2; send++) if (compiledRegions.some(region => region.sends[send] !== 0)) {
            const name = send ? 'chorus' : 'fverb';
            const parameters = SFZ_EFFECT_PARAMETERS[name].map(parameter => parameter.default);
            if (!send) { parameters[1] = 0; parameters[7] = 100; }
            nodes.push({ type: SFZ_EFFECT_TYPES[name], bus: 9 + send, parameters, routes: [], bypassController: -1 });
            direct[`fx${send + 1}tomain`] = 100;
        }
    }
    return { version: 1, profile: SFZ_EFFECT_PROFILE, regions: compiledRegions, nodes, requiredOutputs,
        directToMain: direct.directtomain / 100,
        fxToMain: Array.from({ length: 4 }, (_, index) => (direct[`fx${index + 1}tomain`] ?? 0) / 100),
        fxToMix: Array.from({ length: 4 }, (_, index) => (direct[`fx${index + 1}tomix`] ?? 0) / 100), diagnostics };
}

export function packSfzEffects(plan, resolveImpulse = () => undefined) {
    if (plan.version !== SFZ_EFFECT_LAYOUT.Version || plan.diagnostics.length) throw new Error('Invalid SFZ effect plan.');
    const routeCount = plan.nodes.reduce((total, node) => total + node.routes.length, 0);
    const parameterCount = plan.nodes.reduce((total, node) => total + node.parameters.length, 0);
    const regionOffset = SFZ_EFFECT_LAYOUT.HeaderWords;
    const nodeOffset = regionOffset + plan.regions.length * SFZ_EFFECT_LAYOUT.RegionWords;
    const parameterOffset = nodeOffset + plan.nodes.length * SFZ_EFFECT_LAYOUT.NodeWords;
    const routeOffset = parameterOffset + parameterCount;
    const impulseOffset = routeOffset + routeCount * SFZ_EFFECT_LAYOUT.RouteWords;
    const impulses = new Map();
    for (const node of plan.nodes) if (node.type === SFZ_EFFECT_TYPES.tdfir && !impulses.has(node.impulse)) {
        const info = resolveImpulse(node.impulse);
        const row = info && [info.sampleOffsetOrId, info.frames, info.channels, info.rate];
        if (!row || row.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff) ||
            !info.frames || ![1, 2].includes(info.channels) || info.rate < 1 || info.rate > 768000)
            throw new Error('SFZ effect impulse is not prepared.');
        impulses.set(node.impulse, { index: impulses.size, row });
    }
    const words = impulseOffset + impulses.size * SFZ_EFFECT_LAYOUT.ImpulseWords;
    if (!Number.isSafeInteger(words) || words > 0x3fffffff) throw new Error('SFZ effect plan is too large.');
    const bytes = new Uint8Array(words * 4), u = new Uint32Array(bytes.buffer), f = new Float32Array(bytes.buffer);
    u.set([SFZ_EFFECT_LAYOUT.Version, plan.regions.length, plan.nodes.length, routeCount, parameterCount,
        regionOffset, nodeOffset, parameterOffset, routeOffset, plan.requiredOutputs]);
    f.set([plan.directToMain, ...plan.fxToMain, ...plan.fxToMix], 10);
    u.set([impulseOffset, impulses.size], 20);
    for (const { index, row } of impulses.values()) u.set(row, impulseOffset + index * SFZ_EFFECT_LAYOUT.ImpulseWords);
    for (const [index, region] of plan.regions.entries()) {
        const offset = regionOffset + index * SFZ_EFFECT_LAYOUT.RegionWords;
        u[offset] = region.output; f.set(region.sends, offset + 1);
    }
    let parameterIndex = 0, routeIndex = 0;
    for (const [index, node] of plan.nodes.entries()) {
        const impulse = node.type === SFZ_EFFECT_TYPES.tdfir ? impulses.get(node.impulse).index : 0xffffffff;
        u.set([node.type, node.bus, parameterIndex, node.parameters.length, routeIndex, node.routes.length,
            impulse, node.bypassController + 1], nodeOffset + index * SFZ_EFFECT_LAYOUT.NodeWords);
        f.set(node.parameters, parameterOffset + parameterIndex);
        for (const route of node.routes) {
            const offset = routeOffset + routeIndex++ * SFZ_EFFECT_LAYOUT.RouteWords;
            u[offset] = route.parameter; u[offset + 1] = route.controller;
            f[offset + 2] = route.depth; u[offset + 3] = route.curve;
            f[offset + 4] = route.smooth; f[offset + 5] = route.step;
        }
        parameterIndex += node.parameters.length;
    }
    return bytes;
}

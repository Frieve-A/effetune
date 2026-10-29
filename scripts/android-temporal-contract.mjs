import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPluginManifest } from '../tools/dsp-parity/cases.mjs';

const capabilities = new Set(['stateless', 'reset-on-resume', 'age-by-skipped-frames', 'must-process']);

// The existing methods use constants or conjunctions of parameter comparisons.
// Fail on a new expression shape so Android cannot silently diverge from its source.
export function parseTemporalPolicy(source, inherited = 'reset-on-resume') {
    const assigned = source.match(/this\.temporalCapability\s*=\s*'([^']+)'/);
    const method = source.match(/^\s*getTemporalCapability\(\)\s*\{([\s\S]*?)^\s*\}/m);
    if (!method) return { capability: assigned?.[1] || inherited };
    const literal = method[1].trim().match(/^return\s+'([^']+)';$/);
    if (literal) { if (!capabilities.has(literal[1])) throw new Error('Unknown temporal capability'); return { capability: literal[1] }; }
    const conditional = method[1].trim().match(/^return\s+([\s\S]+?)\s*\?\s*'must-process'\s*:\s*'reset-on-resume';$/);
    if (!conditional) throw new Error('Unsupported temporal method shape');
    const mustProcessWhen = conditional[1].split(/\s*&&\s*/).map(expression => {
        const match = expression.trim().match(/^this\.(\w+)\s*(!==|===|>=|<=|>|<)\s*(false|true|-?\d+(?:\.\d+)?|'[^']*')$/);
        if (!match) throw new Error(`Unsupported temporal condition: ${expression}`);
        const literal = match[3];
        const value = literal.startsWith("'") ? literal.slice(1, -1) : JSON.parse(literal);
        return { key: match[1], operator: match[2], value };
    });
    return { capability: 'reset-on-resume', mustProcessWhen };
}

export async function buildAndroidTemporalContract(root, specs) {
    const base = await readFile(path.join(root, 'plugins/plugin-base.js'), 'utf8');
    const inherited = base.match(/this\.temporalCapability\s*=\s*'([^']+)'/)[1];
    const policies = {}, fixtures = [];
    const byType = new Map(specs.map(spec => [spec.type, spec]));
    for (const plugin of await readPluginManifest(root)) {
        if (!byType.has(plugin.type)) continue;
        const source = await readFile(path.join(root, 'plugins', `${plugin.path}.js`), 'utf8');
        const policy = parseTemporalPolicy(source, inherited);
        if (!capabilities.has(policy.capability)) throw new Error(`Unknown temporal capability for ${plugin.type}`);
        policies[plugin.type] = policy;
        const method = source.match(/^\s*getTemporalCapability\(\)\s*\{([\s\S]*?)^\s*\}/m);
        const evaluate = method ? new Function(method[1]) : function () { return this.temporalCapability; };
        const defaults = {};
        for (const field of byType.get(plugin.type).fields) for (let i = 0; i < field.keys.length; i++) defaults[field.keys[i]] = field.defaults[i];
        const candidates = [{}, { enabled: false }];
        for (const condition of policy.mustProcessWhen || []) candidates.push({ [condition.key]: condition.value });
        for (const parameters of candidates) {
            const object = { ...defaults, temporalCapability: policy.capability, enabled: true, ...parameters };
            const capability = evaluate.call(object);
            fixtures.push({ type: plugin.type, parameters, mustProcess: object.enabled !== false && ['must-process', 'age-by-skipped-frames'].includes(capability) });
        }
    }
    return { policies, fixtures };
}

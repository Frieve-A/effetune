export function matchUrlRule(url, rules, presets) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    for (const rule of rules) {
        if (!rule.enabled || !Object.hasOwn(presets, rule.preset)) continue;
        const slash = rule.pattern.indexOf('/');
        const host = slash < 0 ? rule.pattern : rule.pattern.slice(0, slash);
        const path = slash < 0 ? '/*' : rule.pattern.slice(slash);
        if (matchesGlob(parsed.host, host, true) && matchesGlob(parsed.pathname, path)) return rule.preset;
    }
    return null;
}

function matchesGlob(value, pattern, ignoreCase = false) {
    if (ignoreCase) {
        value = value.toLowerCase();
        pattern = pattern.toLowerCase();
    }
    const parts = pattern.split('*');
    if (parts.length === 1) return value === pattern;

    const prefix = parts[0];
    const suffix = parts[parts.length - 1];
    if (!value.startsWith(prefix) || !value.endsWith(suffix)) return false;
    const suffixStart = value.length - suffix.length;
    let position = prefix.length;
    if (position > suffixStart) return false;
    for (let index = 1; index < parts.length - 1; index++) {
        const part = parts[index];
        if (!part) continue;
        const found = value.indexOf(part, position);
        if (found < 0 || found + part.length > suffixStart) return false;
        position = found + part.length;
    }
    return true;
}

export function validateRules(rules) {
    if (!Array.isArray(rules) || rules.some(rule => !rule || typeof rule.pattern !== 'string' ||
        !rule.pattern.trim() || rule.pattern.includes('://') || /[?#\s]/.test(rule.pattern) ||
        typeof rule.preset !== 'string' || typeof rule.enabled !== 'boolean')) {
        throw new Error('Use a website and path, such as example.com/*, for each URL rule.');
    }
    return rules.map(({ pattern, preset, enabled }) => ({ pattern: pattern.trim(), preset, enabled }));
}

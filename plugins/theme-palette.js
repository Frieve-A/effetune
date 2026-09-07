(() => {
    const cache = new Map();
    let probe;

    function normalizeColor(value) {
        const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
        const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value);
        if (!rgb && !srgb) return '';
        const parts = (rgb || srgb)[1].trim().split(/[\s,/]+/).map(Number);
        if ((parts.length !== 3 && parts.length !== 4) || parts.some(part => !Number.isFinite(part))) return '';
        const [r, g, b, a = 1] = parts;
        const scale = srgb ? 255 : 1;
        return `rgba(${r * scale}, ${g * scale}, ${b * scale}, ${a})`;
    }

    window.ThemePalette = {
        get(name) {
            if (cache.has(name)) return cache.get(name);
            if (typeof document === 'undefined' || !document.documentElement ||
                typeof getComputedStyle !== 'function') return '';
            if (!probe) {
                probe = document.createElement('span');
                probe.style.display = 'none';
                document.documentElement.appendChild(probe);
            }
            probe.style.color = `var(--et-${name})`;
            const color = normalizeColor(getComputedStyle(probe).color || '');
            cache.set(name, color);
            return color;
        },
        refresh() {
            cache.clear();
        }
    };
})();

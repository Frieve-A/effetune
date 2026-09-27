const clamp = value => Math.max(0, Math.min(1, value));
const glowRadius = amount => 2 + clamp(amount) * 12;

export function createLayer(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

export function paletteColor(palette, position, time = 0) {
    const motion = palette.motion;
    let p = clamp(position);
    if (motion.mode === 'scroll') p = (p + time * motion.speed * 0.1) % 1;
    const stops = [...palette.stops].sort((a, b) => a.pos - b.pos);
    let left = stops[0], right = stops[stops.length - 1];
    for (const stop of stops) {
        if (stop.pos <= p) left = stop;
        if (stop.pos >= p) { right = stop; break; }
    }
    const mix = right.pos === left.pos ? 0 : clamp((p - left.pos) / (right.pos - left.pos));
    const rgb = [1, 3, 5].map(offset => {
        const a = parseInt(left.color.slice(offset, offset + 2), 16);
        return a + (parseInt(right.color.slice(offset, offset + 2), 16) - a) * mix;
    });
    if (motion.mode === 'hue') {
        const angle = time * motion.speed * 0.5;
        const c = Math.cos(angle), s = Math.sin(angle);
        const [r, g, b] = rgb;
        rgb[0] = (.213 + c * .787 - s * .213) * r + (.715 - c * .715 - s * .715) * g + (.072 - c * .072 + s * .928) * b;
        rgb[1] = (.213 - c * .213 + s * .143) * r + (.715 + c * .285 + s * .140) * g + (.072 - c * .072 - s * .283) * b;
        rgb[2] = (.213 - c * .213 - s * .787) * r + (.715 - c * .715 + s * .715) * g + (.072 + c * .928 + s * .072) * b;
    }
    return `rgb(${rgb.map(value => Math.round(Math.max(0, Math.min(255, value)))).join(',')})`;
}

export function paletteGradient(ctx, palette, width, time, vertical = false) {
    const gradient = ctx.createLinearGradient(0, vertical ? width : 0, vertical ? 0 : width, 0);
    for (let i = 0; i <= 24; i++) gradient.addColorStop(i / 24, paletteColor(palette, i / 24, time));
    return gradient;
}

export function animatedEffects(effects = []) {
    return effects.some(effect => effect.enabled && (effect.mod.source !== 'none' ||
        effect.palette.motion.mode !== 'none' || ['trail', 'trail-feedback', 'particles', 'shake', 'ken-burns'].includes(effect.type)));
}

// Layer effects share reusable, reduced-resolution canvases. No pixel reads are
// needed, so artwork served from another origin can use the same path.
export class VisualizerEffects {
    constructor() { this.states = new Map(); }
    prune(ids) { for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id); }
    // `scale` is the output width over the 1280-wide reference, so pixel radii keep
    // the same proportion to the scene at any output resolution.
    apply(id, input, effects, time, modulators, quality = 0, changed = true, flipX = false, flipY = false, scale = 1) {
        const factor = quality > 0 ? .35 : .65;
        const width = Math.max(1, Math.round(input.width * factor));
        const height = Math.max(1, Math.round(input.height * factor));
        const active = effects.filter(effect => effect.enabled);
        const padding = active.reduce((max, effect) => effect.type === 'glow'
            ? Math.max(max, Math.ceil(glowRadius(effect.amount + effect.mod.depth) * scale * 3)) : max, 0);
        const workWidth = width + padding * 2, workHeight = height + padding * 2;
        let state = this.states.get(id);
        if (!state || state.a.width !== workWidth || state.a.height !== workHeight || state.padding !== padding) {
            state = { a: createLayer(workWidth, workHeight), b: createLayer(workWidth, workHeight), small: createLayer(1, 1), history: new Map(), particles: [], lastTime: time, bass: 0, padding };
            this.states.set(id, state);
            changed = true;
        }
        if (state.flipX !== flipX || state.flipY !== flipY) {
            state.flipX = flipX; state.flipY = flipY;
            changed = true;
        }
        const transform = { opacity: 1, scale: 1, x: 0, y: 0 };
        if (!active.length) return { canvas: input, ...transform };
        if (!changed && !animatedEffects(active) && state.result) return state.result;
        const effectAmount = effect => {
            const source = effect.mod.source;
            if (source === 'none' || effect.mod.depth === 0) return effect.amount;
            const modulation = source === 'time' ? (1 + Math.sin(time * effect.mod.speed * Math.PI * 2)) / 2 : (modulators[source] || 0);
            return clamp(effect.amount * (1 - effect.mod.depth) + modulation * effect.mod.depth);
        };
        for (const effect of active) {
            if (effect.type === 'scale-pulse') transform.scale *= 1 + effectAmount(effect) * .25;
            else if (effect.type === 'shake') {
                const amount = effectAmount(effect);
                transform.x += Math.sin(time * 53) * amount * .04;
                transform.y += Math.cos(time * 71) * amount * .04;
            } else if (effect.type === 'ken-burns') {
                const amount = effectAmount(effect);
                transform.scale *= 1 + amount * .15;
                transform.x += Math.sin(time * .12) * amount * .035;
                transform.y += Math.cos(time * .09) * amount * .035;
            }
        }
        let current = state.a, next = state.b;
        let ctx = current.getContext('2d');
        ctx.clearRect(0, 0, workWidth, workHeight);
        if (transform.scale !== 1 || transform.x || transform.y) {
            ctx.save();
            ctx.beginPath(); ctx.rect(padding, padding, width, height); ctx.clip();
            ctx.translate(padding + width / 2 + transform.x * width * (flipX ? -1 : 1),
                padding + height / 2 + transform.y * height * (flipY ? -1 : 1));
            ctx.scale(transform.scale, transform.scale);
            ctx.drawImage(input, -width / 2, -height / 2, width, height);
            ctx.restore();
        } else ctx.drawImage(input, padding, padding, width, height);
        const dt = Math.min(.1, Math.max(0, time - state.lastTime));
        state.lastTime = time;
        for (let index = 0; index < active.length; index++) {
            const effect = active[index];
            if (effect.type === 'scale-pulse' || effect.type === 'shake' || effect.type === 'ken-burns') continue;
            const amount = effectAmount(effect);
            if (effect.type === 'opacity') { transform.opacity *= amount; continue; }
            ctx = next.getContext('2d');
            ctx.clearRect(0, 0, workWidth, workHeight);
            ctx.save();
            const color = paletteColor(effect.palette, .5, time);
            if (effect.type === 'glow') {
                const small = state.small;
                small.width = Math.max(1, Math.round(workWidth / (2 + amount * 24)));
                small.height = Math.max(1, Math.round(workHeight / (2 + amount * 24)));
                const scratch = small.getContext('2d');
                scratch.drawImage(current, 0, 0, small.width, small.height);
                scratch.globalCompositeOperation = 'source-in';
                scratch.fillStyle = color;
                scratch.fillRect(0, 0, small.width, small.height);
                scratch.globalCompositeOperation = 'source-over';
                ctx.filter = `blur(${glowRadius(amount) * scale}px)`;
                ctx.globalAlpha = .25;
                ctx.drawImage(current, 0, 0);
                ctx.filter = 'none';
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-in';
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, workWidth, workHeight);
                ctx.globalCompositeOperation = 'lighter';
                ctx.drawImage(small, 0, 0, workWidth, workHeight);
                ctx.drawImage(current, 0, 0);
            } else if (effect.type === 'blur' || effect.type === 'outline') {
                const small = state.small;
                small.width = Math.max(1, Math.round(workWidth / (2 + amount * 24)));
                small.height = Math.max(1, Math.round(workHeight / (2 + amount * 24)));
                const scratch = small.getContext('2d');
                scratch.drawImage(current, 0, 0, small.width, small.height);
                if (effect.type !== 'blur') {
                    scratch.globalCompositeOperation = 'source-in';
                    scratch.fillStyle = color;
                    scratch.fillRect(0, 0, small.width, small.height);
                    scratch.globalCompositeOperation = 'source-over';
                }
                if (effect.type === 'outline') {
                    const offset = (1 + amount * 6) * scale;
                    for (let angle = 0; angle < 8; angle++) ctx.drawImage(small, Math.cos(angle * Math.PI / 4) * offset, Math.sin(angle * Math.PI / 4) * offset, workWidth, workHeight);
                } else ctx.drawImage(small, 0, 0, workWidth, workHeight);
                if (effect.type !== 'blur') { ctx.drawImage(current, 0, 0); }
            } else if (effect.type === 'trail' || effect.type === 'trail-feedback') {
                let history = state.history.get(index);
                if (!history) { history = createLayer(workWidth, workHeight); state.history.set(index, history); }
                ctx.globalAlpha = Math.pow(.15 + amount * .84, dt * 60);
                if (effect.type === 'trail-feedback') {
                    ctx.translate(workWidth / 2 + amount * (effect.flowX ?? 0) * width / 100 * (flipX ? -1 : 1),
                        workHeight / 2 + amount * (effect.flowY ?? 0) * height / 100 * (flipY ? -1 : 1));
                    ctx.rotate(amount * (effect.angle ?? 1.15) * Math.PI / 180 * (flipX !== flipY ? -1 : 1));
                    const scale = 1 + amount * (effect.zoom ?? 2) / 100;
                    ctx.scale(scale, scale);
                    ctx.drawImage(history, -workWidth / 2, -workHeight / 2); ctx.setTransform(1, 0, 0, 1, 0, 0);
                } else ctx.drawImage(history, 0, 0);
                ctx.globalAlpha = 1;
                ctx.drawImage(current, 0, 0);
                const historyCtx = history.getContext('2d');
                historyCtx.clearRect(0, 0, workWidth, workHeight); historyCtx.drawImage(next, 0, 0);
            } else if (effect.type === 'symmetry') {
                const count = 2 + Math.round(amount * 6);
                ctx.translate(workWidth / 2, workHeight / 2);
                ctx.globalAlpha = 1 / Math.sqrt(count);
                for (let i = 0; i < count; i++) {
                    ctx.save(); ctx.rotate(i * Math.PI * 2 / count); ctx.scale(i % 2 ? -1 : 1, 1); ctx.drawImage(current, -workWidth / 2, -workHeight / 2); ctx.restore();
                }
            } else if (effect.type === 'particles') {
                ctx.drawImage(current, 0, 0);
                const limit = quality > 1 ? 24 : quality > 0 ? 48 : 96;
                if (modulators.bass > state.bass + .035) {
                    for (let i = 0; i < 8 + amount * 16; i++) {
                        let particle = state.particles.find(value => value.life <= 0);
                        if (!particle && state.particles.length < limit) { particle = {}; state.particles.push(particle); }
                        if (!particle) break;
                        Object.assign(particle, { x: padding + Math.random() * width, y: padding + Math.random() * height, vx: (Math.random() - .5) * width, vy: (Math.random() - .5) * height, life: 1 });
                    }
                }
                ctx.fillStyle = color;
                for (const particle of state.particles) {
                    if (particle.life <= 0) continue;
                    particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt;
                    const size = (2 + amount * 4) * scale;
                    ctx.globalAlpha = Math.max(0, particle.life); ctx.fillRect(particle.x, particle.y, size, size);
                }
            } else {
                ctx.drawImage(current, 0, 0);
                if (effect.type === 'flash') { ctx.globalAlpha = amount; ctx.fillStyle = color; ctx.fillRect(padding, padding, width, height); }
            }
            ctx.restore();
            [current, next] = [next, current];
        }
        state.bass = modulators.bass;
        state.result = { canvas: current, opacity: transform.opacity, scale: 1, x: 0, y: 0,
            paddingX: padding * input.width / width, paddingY: padding * input.height / height };
        return state.result;
    }
}

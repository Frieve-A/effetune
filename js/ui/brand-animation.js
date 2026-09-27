/**
 * Brand intro animation shared by the Electron splash window and the About dialog.
 *
 * The scene illustrates the app concept: a raw signal flows into the EffeTune
 * icon and leaves it as a clean, tuned waveform, while a live spectrum at the
 * bottom is shaped by an EQ curve that dials itself in. Everything is drawn
 * procedurally on a 2D canvas using the current theme tokens, so no assets are
 * loaded.
 */

const BEAT_SECONDS = 60 / 124;
const BAR_COUNT = 56;
const INTRO_SECONDS = 1.4;
const MAX_PARTICLES = 48;
// EQ bands as [center (0..1 across the spectrum), width, gain dB].
const EQ_BANDS = [[0.1, 0.12, 5], [0.42, 0.1, -2.5], [0.72, 0.12, 3.5], [0.96, 0.1, 2]];

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = v => 1 - (1 - v) ** 3;
const easeOutBack = v => 1 + 2.2 * (v - 1) ** 3 + 1.2 * (v - 1) ** 2;
const fract = v => v - Math.floor(v);

function readThemeColors(element) {
  const style = getComputedStyle(element);
  const token = name => style.getPropertyValue(name).trim() || style.color;
  return {
    accent: token('--et-accent'),
    text: token('--et-text-primary'),
    dark: style.getPropertyValue('--et-color-scheme').trim() !== 'light'
  };
}

function eqGainDb(f, t, morph) {
  let db = 0;
  for (let k = 0; k < EQ_BANDS.length; k++) {
    const [center, width, gain] = EQ_BANDS[k];
    const d = (f - center) / width;
    db += (gain + 0.7 * Math.sin(t * 0.8 + k * 1.9)) * Math.exp(-d * d);
  }
  return db * morph;
}

/**
 * Start the animation.
 * @param {HTMLCanvasElement} canvas - Canvas covering the host surface.
 * @param {Object} options
 * @param {HTMLElement} options.icon - App icon; the signal flows through its center.
 * @param {HTMLElement} [options.title] - Title element that "tunes in".
 * @param {HTMLElement[]} [options.reveal] - Elements revealed in order after the title.
 * @returns {Function} Stops the animation and releases observers.
 */
export function startBrandAnimation(canvas, { icon, title, reveal = [] }) {
  const ctx = canvas.getContext('2d');
  const colors = readThemeColors(canvas);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bars = new Float32Array(BAR_COUNT);
  const particles = [];
  let width = 0;
  let height = 0;
  let iconX = 0;
  let iconY = 0;
  let iconRadius = 32;
  let frameId = 0;
  let startTime = -1;
  let lastTime = 0;
  let lastBeat = -1;

  const layout = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const iconRect = icon.getBoundingClientRect();
    iconX = iconRect.left - rect.left + iconRect.width / 2;
    iconY = iconRect.top - rect.top + iconRect.height / 2;
    iconRadius = iconRect.width / 2;
  };
  // Settle the analyzer on a representative frame without motion.
  const drawStill = () => {
    for (let n = 0; n < 60; n++) render(3 + n / 60, 1 / 60);
  };
  const resizeObserver = new ResizeObserver(() => {
    layout();
    if (reducedMotion) drawStill();
  });
  resizeObserver.observe(canvas);
  layout();

  const drawWaveform = (t, kick) => {
    const amp = 9 + 5 * kick;
    const gap = iconRadius + 10;
    const inReveal = easeOutCubic(clamp01(t / 0.6)) * (iconX - gap);
    const outReveal = easeOutCubic(clamp01((t - 0.55) / 0.7)) * (width - iconX - gap);
    ctx.lineJoin = 'round';

    // Raw input: jittery and dull, entering from the left.
    if (inReveal > 0) {
      ctx.beginPath();
      for (let x = 0; x <= inReveal; x += 2) {
        const clean = Math.sin(x * 0.07 - t * 9) + 0.5 * Math.sin(x * 0.16 - t * 13);
        const grit = 0.45 * Math.sin(x * 1.3 + t * 41) + 0.3 * Math.sin(x * 2.7 - t * 29);
        const edge = clamp01(x / 40) * clamp01((iconX - gap - x) / 24);
        const y = iconY + (clean + grit) * amp * 0.55 * edge;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Tuned output: smooth, glowing and breathing with the beat.
    if (outReveal > 0) {
      const x0 = iconX + gap;
      ctx.beginPath();
      for (let dx = 0; dx <= outReveal; dx += 2) {
        const x = x0 + dx;
        const s = Math.sin(dx * 0.06 - t * 9) + 0.35 * Math.sin(dx * 0.12 - t * 18 + 0.6);
        const edge = clamp01(dx / 24) * clamp01((width - x) / 40);
        const y = iconY + s * amp * edge;
        dx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  };

  const drawRings = (t, phase) => {
    if (t < 0.55) return;
    ctx.strokeStyle = colors.accent;
    // The first flash marks the moment the tuned signal leaves the icon.
    const flash = clamp01((t - 0.55) / 0.6);
    if (flash < 1) {
      ctx.globalAlpha = 0.5 * (1 - flash);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(iconX, iconY, iconRadius + 4 + flash * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let k = 0; k < 3; k++) {
      const age = (fract(phase) + k) * BEAT_SECONDS;
      const life = age / (3 * BEAT_SECONDS);
      ctx.globalAlpha = 0.3 * (1 - life) * clamp01((t - 0.55) / 0.5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(iconX, iconY, iconRadius + 6 + easeOutCubic(life) * 130, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const drawSpectrum = (t, dt, phase, morph) => {
    const areaHeight = height * 0.28;
    const bottom = height;
    const slot = width / BAR_COUNT;
    const beatFrac = fract(phase);
    const kick = Math.exp(-6 * beatFrac);
    const snare = Math.floor(phase) % 2 === 1 ? Math.exp(-8 * beatFrac) : 0;
    const hat = Math.exp(-12 * fract(phase + 0.5));
    const sweep = easeOutCubic(clamp01(t / 0.9));

    ctx.fillStyle = colors.accent;
    for (let i = 0; i < BAR_COUNT; i++) {
      const f = i / (BAR_COUNT - 1);
      let level = 0.42 - 0.2 * f
        + 0.1 * Math.sin(t * 1.7 + i * 0.6)
        + 0.07 * Math.sin(t * 2.9 - i * 1.3)
        + 0.05 * Math.sin(t * 5.3 + i * 2.7);
      level += kick * 0.5 * clamp01(1 - f / 0.22);
      level += snare * 0.3 * clamp01(1 - Math.abs(f - 0.45) / 0.18);
      level += hat * 0.25 * clamp01((f - 0.6) / 0.3);
      level *= 1 + eqGainDb(f, t, morph) / 12;
      level *= clamp01((sweep * 1.25 - f) * 4);
      level = clamp01(level);
      // Fast attack and slow release, like a real analyzer.
      bars[i] = level > bars[i] ? level : bars[i] + (level - bars[i]) * clamp01(dt * 7);

      const x = i * slot + slot * 0.18;
      const w = slot * 0.64;
      const h = bars[i] * areaHeight;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x, bottom - h, w, h);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, bottom - h - 2, w, 1.5);
    }
    return { kick, areaHeight };
  };

  const drawEqCurve = (t, morph, areaHeight) => {
    const reveal = easeOutCubic(clamp01((t - 0.1) / 0.9)) * width;
    if (reveal <= 0) return;
    const curveY = f => height - areaHeight * (0.38 + eqGainDb(f, t, morph) / 20);
    ctx.beginPath();
    for (let x = 0; x <= reveal; x += 3) {
      const y = curveY(x / width);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = colors.text;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // EQ handles pop into place as the curve is dialed in.
    for (let k = 0; k < EQ_BANDS.length; k++) {
      const pop = clamp01((t - 0.45 - k * 0.12) / 0.4);
      const x = EQ_BANDS[k][0] * width;
      if (pop <= 0 || x > reveal) continue;
      const r = 4 * easeOutBack(pop);
      ctx.globalAlpha = 0.9 * pop;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(x, curveY(EQ_BANDS[k][0]), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };

  const drawParticles = (dt, spawn, areaHeight) => {
    for (let n = 0; n < spawn && particles.length < MAX_PARTICLES; n++) {
      const i = Math.floor(Math.random() * BAR_COUNT);
      particles.push({
        x: (i + 0.5) * (width / BAR_COUNT),
        y: height - bars[i] * areaHeight - 4,
        vy: -(18 + Math.random() * 30),
        vx: (Math.random() - 0.5) * 10,
        life: 0,
        span: 1.2 + Math.random() * 0.8,
        r: 0.8 + Math.random() * 1.4
      });
    }
    ctx.fillStyle = colors.accent;
    for (let n = particles.length - 1; n >= 0; n--) {
      const p = particles[n];
      p.life += dt;
      if (p.life >= p.span) {
        particles.splice(n, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 0.7 * (1 - p.life / p.span);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const render = (t, dt) => {
    const phase = t > 0.4 ? (t - 0.4) / BEAT_SECONDS : 0;
    const morph = easeOutCubic(clamp01((t - 0.25) / 1.0));
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = colors.dark ? 'lighter' : 'source-over';
    const { kick, areaHeight } = drawSpectrum(t, dt, phase, morph);
    drawEqCurve(t, morph, areaHeight);
    drawRings(t, phase);
    drawWaveform(t, t > 0.4 ? kick : 0);
    const beat = Math.floor(phase);
    drawParticles(dt, t > 0.4 && beat !== lastBeat ? 4 : 0, areaHeight);
    lastBeat = beat;
    ctx.globalAlpha = 1;
    // The icon pulses with the beat once its entrance has finished.
    if (t > INTRO_SECONDS) icon.style.transform = `scale(${1 + 0.05 * kick})`;
  };

  const frame = now => {
    if (startTime < 0) {
      startTime = now;
      lastTime = now;
    }
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    render((now - startTime) / 1000, dt);
    frameId = requestAnimationFrame(frame);
  };

  if (reducedMotion) {
    drawStill();
  } else {
    const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    icon.animate([
      { opacity: 0, transform: 'scale(0.3) rotate(-25deg)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'scale(1.12) rotate(4deg)', filter: 'blur(0)', offset: 0.65 },
      { opacity: 1, transform: 'scale(1) rotate(0deg)', filter: 'blur(0)' }
    ], { duration: 750, easing: ease, fill: 'backwards' });
    title?.animate([
      { opacity: 0, letterSpacing: '0.45em', filter: 'blur(5px)' },
      { opacity: 1, letterSpacing: 'normal', filter: 'blur(0)' }
    ], { duration: 800, delay: 200, easing: ease, fill: 'backwards' });
    reveal.forEach((element, index) => element.animate([
      { opacity: 0, transform: 'translateY(8px)', filter: 'blur(3px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' }
    ], { duration: 500, delay: 450 + index * 90, easing: ease, fill: 'backwards' }));
    frameId = requestAnimationFrame(frame);
  }

  return () => {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
  };
}

const CLOCK_INTERVAL_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function clamp(value, minimum = 0, maximum = 1) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function localDateKey({ year, month, day }) {
  return [year, month, day].join('-');
}

function nextLocalDate(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { year: next.getFullYear(), month: next.getMonth(), day: next.getDate() };
}

function nextDailyDateFromNow(source, nowDate) {
  const today = { year: nowDate.getFullYear(), month: nowDate.getMonth(), day: nowDate.getDate() };
  return localOccurrence(today, source) > nowDate ? today : nextLocalDate(nowDate);
}

function localOccurrence({ year, month, day }, source) {
  return new Date(year, month, day, source.hour, source.minute, source.second, 0);
}

function timerSchedule(source) {
  return source.schedule || 'interval';
}

function scheduleIdentity(source) {
  if (source.schedule === 'once') {
    return `once:${source.date}:${source.hour}:${source.minute}:${source.second}`;
  }
  if (source.schedule === 'daily') return `daily:${source.hour}:${source.minute}:${source.second}`;
  return `interval:${source.intervalMs}`;
}

export function evaluateClockSource(source, date) {
  const milliseconds = date.getMilliseconds();
  let phase;
  if (source.component === 'hour') {
    phase = (date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 +
      milliseconds / 3600000) / 24;
  } else if (source.component === 'minute') {
    phase = (date.getMinutes() + date.getSeconds() / 60 + milliseconds / 60000) / 60;
  } else {
    phase = (date.getSeconds() + milliseconds / 1000) / 60;
  }
  if (source.shape === 'sin') return clamp((Math.sin(2 * Math.PI * phase) + 1) / 2);
  if (source.shape === 'cos') return clamp((Math.cos(2 * Math.PI * phase) + 1) / 2);
  return clamp(phase);
}

export class AutomationScheduler {
  constructor({
    engine,
    nowDate = () => new Date(),
    nowMonotonic = () => globalThis.performance?.now?.() ?? Date.now(),
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (...args) => globalThis.clearTimeout(...args)
  } = {}) {
    this.engine = engine;
    this.nowDate = nowDate;
    this.nowMonotonic = nowMonotonic;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.clockMappings = [];
    this.timerMappings = [];
    this.timerStates = new Map();
    this.nextClockAt = null;
    this.nextWallCheckAt = null;
    this.timerHandle = null;
    this.disposed = false;
  }

  sync(mappings = []) {
    this.stopTimer();
    const nowMonotonic = this.nowMonotonic();
    const nowDate = this.nowDate();
    this.clockMappings = mappings.filter(mapping => mapping?.source?.kind === 'clock');
    this.timerMappings = mappings.filter(mapping => mapping?.source?.kind === 'timer');
    const nextStates = new Map();
    for (const mapping of this.timerMappings) {
      const identity = scheduleIdentity(mapping.source);
      const existing = this.timerStates.get(mapping.id);
      nextStates.set(mapping.id, existing?.identity === identity
        ? existing
        : this.createTimerState(mapping.source, identity, nowMonotonic, nowDate));
    }
    this.timerStates = nextStates;
    if (this.clockMappings.length === 0) this.nextClockAt = null;
    else if (this.nextClockAt === null) this.nextClockAt = nowMonotonic;
    const hasWallSchedule = this.timerMappings.some(mapping => timerSchedule(mapping.source) !== 'interval');
    if (!hasWallSchedule) this.nextWallCheckAt = null;
    else if (this.nextWallCheckAt === null) this.nextWallCheckAt = nowMonotonic + CLOCK_INTERVAL_MS;
    this.disposed = false;
    this.scheduleNext();
  }

  createTimerState(source, identity, nowMonotonic, nowDate) {
    const schedule = timerSchedule(source);
    if (schedule === 'interval') return { identity, deadline: nowMonotonic + source.intervalMs };
    if (schedule === 'once') {
      const [year, month, day] = source.date.split('-').map(Number);
      const occurrence = localOccurrence({ year, month: month - 1, day }, source);
      return { identity, occurrence, expired: occurrence <= nowDate, fired: false };
    }
    const nextDate = nextDailyDateFromNow(source, nowDate);
    return { identity, nextDate, lastFiredLocalDate: null };
  }

  dispose() {
    this.stopTimer();
    this.clockMappings = [];
    this.timerMappings = [];
    this.timerStates.clear();
    this.nextClockAt = null;
    this.nextWallCheckAt = null;
    this.disposed = true;
  }

  stopTimer() {
    if (this.timerHandle !== null) this.clearTimeoutFn(this.timerHandle);
    this.timerHandle = null;
  }

  scheduleNext() {
    if (this.disposed) return;
    const deadlines = [];
    for (const state of this.timerStates.values()) {
      if (state.deadline !== undefined) deadlines.push(state.deadline);
    }
    if (this.nextClockAt !== null) deadlines.push(this.nextClockAt);
    if (this.nextWallCheckAt !== null) deadlines.push(this.nextWallCheckAt);
    if (deadlines.length === 0) return;
    const delay = Math.max(0, Math.min(...deadlines) - this.nowMonotonic());
    if (delay > MAX_TIMER_DELAY_MS) return;
    this.timerHandle = this.setTimeoutFn(() => this.onTimer(), delay);
  }

  onTimer() {
    this.timerHandle = null;
    if (this.disposed) return;
    const nowMonotonic = this.nowMonotonic();
    const wallCheckDue = this.nextWallCheckAt !== null && nowMonotonic >= this.nextWallCheckAt;
    const clockDue = this.nextClockAt !== null && nowMonotonic >= this.nextClockAt;
    const nowDate = clockDue || wallCheckDue ? this.nowDate() : null;
    if (clockDue) {
      for (const mapping of this.clockMappings) {
        this.engine?.onAutomationEvent?.(mapping.id, {
          kind: 'clock', value: evaluateClockSource(mapping.source, nowDate)
        });
      }
      this.nextClockAt = nowMonotonic + CLOCK_INTERVAL_MS;
    }
    for (const mapping of this.timerMappings) {
      const state = this.timerStates.get(mapping.id);
      if (state?.deadline === undefined || nowMonotonic < state.deadline) continue;
      this.engine?.onAutomationEvent?.(mapping.id, { kind: 'timer' });
      state.deadline = nowMonotonic + mapping.source.intervalMs;
    }
    if (wallCheckDue) {
      for (const mapping of this.timerMappings) this.processWallSchedule(mapping, nowDate);
      this.nextWallCheckAt = nowMonotonic + CLOCK_INTERVAL_MS;
    }
    this.scheduleNext();
  }

  processWallSchedule(mapping, nowDate) {
    const source = mapping.source;
    const state = this.timerStates.get(mapping.id);
    if (!state || timerSchedule(source) === 'interval') return;
    if (source.schedule === 'once') {
      if (!state.expired && !state.fired && nowDate >= state.occurrence) {
        state.fired = true;
        this.engine?.onAutomationEvent?.(mapping.id, { kind: 'timer' });
      }
      return;
    }
    const occurrence = localOccurrence(state.nextDate, source);
    const armedDateKey = localDateKey(state.nextDate);
    if (nowDate < occurrence || state.lastFiredLocalDate === armedDateKey) return;
    state.lastFiredLocalDate = armedDateKey;
    state.nextDate = nextLocalDate(nowDate);
    this.engine?.onAutomationEvent?.(mapping.id, { kind: 'timer' });
  }
}

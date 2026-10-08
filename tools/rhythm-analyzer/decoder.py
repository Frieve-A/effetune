"""Production arithmetic for the frozen forward DBN, gate and block Viterbi."""
import math

import numpy as np
from numba import njit

import numeric as N


class Tables:
    def __init__(self, minimum=40.0, maximum=240.0, dp_precision=32):
        self.minimum, self.maximum = minimum, maximum
        self.intervals = np.arange(round(60 * N.FPS / maximum), round(60 * N.FPS / minimum) + 1)
        self.first = np.cumsum(np.r_[0, self.intervals[:-1]])
        self.last = self.first + self.intervals - 1
        self.chain = np.repeat(np.arange(len(self.intervals)), self.intervals)
        self.states = len(self.chain)
        # This is the production portable table policy, checked against the frozen
        # NumPy state/tempo maps. First-index ties follow strict '>' comparisons.
        phase = np.concatenate([np.arange(iv, dtype=np.float64) / iv for iv in self.intervals])
        self.beat_mask = phase < 1.0 / 16.0
        self.cos = np.empty(self.states, np.float64)
        self.sin = np.empty(self.states, np.float64)
        for i, p in enumerate(phase):
            self.sin[i], self.cos[i] = N.portable_sincos(6.283185307179586 * p)
        tempo_logs = np.array([N.portable_log(30.0) + N.portable_log(10.0) * i / 60.0 for i in range(61)])
        self.tempo_class = np.array([np.argmin(np.abs(tempo_logs - N.portable_log(60 * N.FPS / iv)))
                                     for iv in self.intervals])
        count = len(self.intervals)
        probability = np.zeros((count, count), np.float64)
        for source, iv in enumerate(self.intervals):
            total = 0.0
            for destination, other in enumerate(self.intervals):
                weight = N.portable_exp(-100.0 * abs(float(other) / float(iv) - 1.0))
                if weight <= 2.0 ** -52:
                    weight = 0.0
                probability[source, destination] = weight
                total += weight
            probability[source] /= total
        self.probability = probability
        self.edges = np.count_nonzero(probability, axis=0)
        self.sources = np.zeros((count, count), np.int64)
        self.weights = np.zeros((count, count), np.float64)
        self.dp_type = np.float32 if dp_precision == 32 else np.float64
        self.log_weights = np.zeros((count, count), self.dp_type)
        for destination in range(count):
            sources = np.flatnonzero(probability[:, destination])
            for edge, source in enumerate(sources):
                value = probability[source, destination]
                self.sources[destination, edge] = source
                self.weights[destination, edge] = value
                self.log_weights[destination, edge] = N.portable_log(value)


@njit(fastmath=False)
def advance(activation, tempo, alpha, dp, first, last, chain, beat_mask, tempo_class,
            sources, weights, log_weights, edges, cos_table, sin_table, log_observation, log_prior):
    count, states = first.size, alpha.size
    prior = np.empty(count, np.float64)
    back = np.zeros(count, np.int64)
    new, next_dp = np.empty_like(alpha), np.empty_like(dp)
    a = np.float64(activation)
    off = (1.0 - a) / 15.0
    log_observation[0], log_observation[1] = N.portable_log(a), N.portable_log(off)
    for destination in range(count):
        total, best, choice = 0.0, -math.inf, 0
        for edge in range(edges[destination]):
            source = sources[destination, edge]
            total += alpha[last[source]] * weights[destination, edge]
            candidate = dp[last[source]] + log_weights[destination, edge]
            if candidate > best:
                best, choice = candidate, source
        new[first[destination]], next_dp[first[destination]] = total, best
        back[destination] = choice
        probability = max(np.float64(tempo[tempo_class[destination]]), 1.0e-4)
        log = .03 * N.portable_log(probability)
        prior[destination], log_prior[destination] = N.portable_exp(log), log
    total = 0.0
    for state in range(states):
        if state != first[chain[state]]:
            new[state], next_dp[state] = alpha[state - 1], dp[state - 1]
        new[state] *= a if beat_mask[state] else off
        total += new[state]
        # Storing after each operation is significant for the float32 DP.
        next_dp[state] = next_dp[state] + log_observation[0 if beat_mask[state] else 1]
        next_dp[state] = next_dp[state] + log_prior[chain[state]]
    evidence = N.portable_log(16.0 * total) if total > 0 else -50.0
    if not math.isfinite(evidence):
        evidence = -50.0
    inverse = 1.0 / total if total > 0 else 0.0
    prior_total = 0.0
    top = next_dp[0]
    for state in range(states):
        new[state] *= inverse
        new[state] *= prior[chain[state]]
        prior_total += new[state]
        if next_dp[state] > top:
            top = next_dp[state]
    prior_inverse = 1.0 / prior_total if prior_total > 0 else 0.0
    cosine, sine = 0.0, 0.0
    marginal = np.zeros(count, np.float64)
    for state in range(states):
        alpha[state] = new[state] * prior_inverse
        dp[state] = next_dp[state] - top
        marginal[chain[state]] += alpha[state]
        cosine += alpha[state] * cos_table[state]
        sine += alpha[state] * sin_table[state]
    best = 0
    for c in range(1, count):
        if marginal[c] > marginal[best]:
            best = c
    phase = N.portable_atan2(sine, cosine) / 6.283185307179586
    if phase < 0:
        phase += 1.0
    return back, marginal, best, phase, evidence


@njit(fastmath=False)
def traceback(dp, back, first, last, chain, start, end, deciding):
    state = 0
    for s in range(1, dp.size):
        if dp[s] > dp[state]:
            state = s
    path = np.empty(end - start, np.int64)
    for j in range(deciding, start - 1, -1):
        if j < end:
            path[j - start] = state
        c = chain[state]
        state = last[back[j % back.shape[0], c]] if state == first[c] else state - 1
    return path


class Decoder:
    def __init__(self, minimum=40.0, maximum=240.0, dp_precision=32):
        self.tables = Tables(minimum, maximum, dp_precision)
        self.minimum_period = 60 * N.FPS / maximum
        self.block = self.lag = round(N.FPS)
        self.capacity = self.block + self.lag + 1
        self.reset()

    def reset(self):
        t = self.tables
        self.alpha = np.full(t.states, 1.0 / t.states, np.float64)
        self.dp = np.full(t.states, -N.portable_log(float(t.states)), t.dp_type)
        self.log_observation = np.empty(2, t.dp_type)
        self.log_prior = np.empty(len(t.intervals), t.dp_type)
        self.back = np.zeros((self.capacity, len(t.intervals)), np.int64)
        self.activations = np.zeros(self.capacity, np.float32)
        self.tick = self.committed = 0
        self.last_beat = self.short = self.long = 0.0
        self.shown = False
        self.region = None
        self.forward_events, self.analysis_events = [], []
        self.committed_path, self.committed_availability = [], []

    def commit(self, end, deciding):
        t = self.tables
        path = traceback(self.dp, self.back, t.first, t.last, t.chain, self.committed, end, deciding)
        self.committed_path.extend(path.tolist())
        self.committed_availability.extend([deciding] * len(path))
        for j, state in enumerate(path, self.committed):
            if not t.beat_mask[state]:
                self.close_region(deciding)
                continue
            activation = self.activations[j % self.capacity]
            if self.region is None or activation > self.region[1]:
                self.region = (j, activation, int(t.intervals[t.chain[state]]))
        self.committed = end

    def close_region(self, deciding):
        if self.region is not None:
            peak, _, period = self.region
            self.analysis_events.append((peak, deciding, period))
            self.region = None

    def step(self, activation, tempo, hard=False):
        t = self.tables
        back, marginal, best, phase, evidence = advance(
            activation, tempo, self.alpha, self.dp, t.first, t.last, t.chain, t.beat_mask,
            t.tempo_class, t.sources, t.weights, t.log_weights, t.edges, t.cos, t.sin,
            self.log_observation, self.log_prior)
        self.back[self.tick % self.capacity] = back
        period = int(t.intervals[best])
        if hard:
            self.short, self.long, self.shown = 0.0, 0.0, False
            confidence = 0.0
        else:
            self.short = (N.DT / .5) * evidence + (1.0 - N.DT / .5) * self.short
            self.long = (N.DT / 2.0) * evidence + (1.0 - N.DT / 2.0) * self.long
            self.shown = self.short > 0.0 or (self.shown and self.long > .02)
            confidence = 1.0 / (1.0 + N.portable_exp(-(-1.0543807556114948 + 31.820095025649806 * self.short)))
        distance = (1.0 - phase) * period if phase >= .5 else -phase * period
        prediction = self.tick + distance
        if distance <= .025 / N.DT and prediction >= self.last_beat + self.minimum_period:
            self.last_beat = prediction
            self.forward_events.append((prediction, self.tick, period, self.shown))
        self.activations[self.tick % self.capacity] = activation
        if self.tick >= self.committed + self.block - 1 + self.lag:
            self.commit(self.committed + self.block, self.tick)
        self.tick += 1
        return period, phase, evidence, confidence, self.shown, marginal

    def flush(self):
        if self.committed < self.tick:
            self.commit(self.tick, self.tick - 1)
        self.close_region(self.tick - 1)

    def run(self, activations, tempo, hard=None, flush=True):
        columns = []
        for k, a in enumerate(activations):
            columns.append(self.step(a, tempo[k], False if hard is None else hard[k]))
        if flush:
            self.flush()
        return columns

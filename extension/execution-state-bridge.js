function sameExecutionState(message, state) {
  return state.pluginId === message.pluginId &&
    state.pluginType === message.pluginType &&
    state.state === message.state &&
    state.reason === (message.reason ?? null) &&
    state.jsFallbackSampleChannels === (message.jsFallbackSampleChannels ?? 0) &&
    state.generation === message.generation;
}

export function validateDspExecutionMessage(message, snapshot) {
  if (message?.type !== 'dspExecutionState' || !Array.isArray(snapshot?.states)) return null;
  const state = snapshot.states.find(candidate => sameExecutionState(message, candidate));
  return state ? { ...message, validated: true } : null;
}

export function replayDspExecutionStates(snapshot, publish) {
  for (const state of snapshot?.states || []) {
    publish({ type: 'dspExecutionState', ...state, validated: true });
  }
}

export function publishStateThenDspExecution(publishState, audioManager, publishMessage) {
  const state = publishState();
  replayDspExecutionStates(audioManager.getDspExecutionStateSnapshot(), publishMessage);
  return state;
}

export function routeOffscreenWorkletMessage(message, {
  hasViewers,
  handle,
  publish,
  getExecutionSnapshot
}) {
  if (message?.type === 'dspExecutionState') {
    handle(message);
    const forwarded = validateDspExecutionMessage(message, getExecutionSnapshot());
    if (forwarded && hasViewers) publish(forwarded);
    return forwarded;
  }

  if (['powerObservation', 'powerStateAck'].includes(message?.type)) {
    handle(message);
    return message;
  }

  if (hasViewers) {
    try {
      publish(message);
    } finally {
      handle(message);
    }
    return message;
  }

  handle(message);
  return message;
}

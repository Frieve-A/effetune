function withoutExtension(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

export function parseTrueStereoSide(name) {
  const stem = withoutExtension(name).trim();
  const word = stem.match(/^(.*?)[\s_.-]*(left|right)$/i);
  const letter = word || stem.match(/^(.*?)[\s_.-]*([lr])$/i);
  if (!letter || !letter[1]) return null;
  const side = letter[2].toLowerCase();
  return {
    base: letter[1].replace(/[\s_.-]+$/, '').trim().toLowerCase(),
    displayBase: letter[1].replace(/[\s_.-]+$/, '').trim(),
    side: side === 'l' || side === 'left' ? 'left' : 'right'
  };
}

function copyPadded(channel, frames) {
  const result = new Float32Array(frames);
  result.set(channel.subarray(0, frames));
  return result;
}

export function mergeTrueStereoPair(entries) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new TypeError('Choose one left and one right stereo impulse-response file.');
  }
  const parsed = entries.map(entry => ({ ...entry, naming: parseTrueStereoSide(entry?.name) }));
  if (parsed.some(entry => !entry.naming) || parsed[0].naming.base !== parsed[1].naming.base ||
      parsed[0].naming.side === parsed[1].naming.side) {
    throw new TypeError('The two files must have matching names ending in L/R or Left/Right.');
  }
  for (const entry of parsed) {
    if (!Array.isArray(entry.pcm?.channels) || entry.pcm.channels.length !== 2 ||
        !Number.isFinite(entry.pcm.sampleRate) || entry.pcm.sampleRate <= 0) {
      throw new TypeError('Each true-stereo pair file must contain exactly two audio channels.');
    }
  }
  if (Math.round(parsed[0].pcm.sampleRate) !== Math.round(parsed[1].pcm.sampleRate)) {
    throw new TypeError('The left and right impulse-response files must use the same sample rate.');
  }

  const left = parsed.find(entry => entry.naming.side === 'left');
  const right = parsed.find(entry => entry.naming.side === 'right');
  const frames = Math.max(left.pcm.channels[0].length, left.pcm.channels[1].length,
    right.pcm.channels[0].length, right.pcm.channels[1].length);
  return {
    channels: [
      copyPadded(left.pcm.channels[0], frames),
      copyPadded(left.pcm.channels[1], frames),
      copyPadded(right.pcm.channels[0], frames),
      copyPadded(right.pcm.channels[1], frames)
    ],
    sampleRate: left.pcm.sampleRate,
    topologyHint: 'true-stereo'
  };
}

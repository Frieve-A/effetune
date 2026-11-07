const { contextBridge, ipcRenderer } = require('electron');

// Runs in each page frame's main world before page scripts. Pages see one
// virtual Web MIDI output named EffeTune; its messages are relayed to the app
// as live MIDI input and never reach a real MIDI device. The function is
// serialized into the page, so it must not reference anything outside itself.
function installVirtualMidi(post) {
  if (!['http:', 'https:', 'file:'].includes(location.protocol) || typeof navigator === 'undefined') return;
  const MAX_EVENTS = 256;
  let queue = [];
  let flushScheduled = false;

  function flush() {
    flushScheduled = false;
    const events = queue;
    queue = [];
    for (let index = 0; index < events.length; index += MAX_EVENTS) post(events.slice(index, index + MAX_EVENTS));
  }

  function invalid(reason) {
    throw new TypeError(`Failed to execute 'send' on 'MIDIOutput': ${reason}`);
  }

  // Message length by status byte; 0 starts SysEx, undefined is invalid.
  function messageLength(status) {
    if (status < 0xf0) return (status & 0xe0) === 0xc0 ? 2 : 3;
    return { 0xf0: 0, 0xf1: 2, 0xf2: 3, 0xf3: 2, 0xf6: 1 }[status];
  }

  // Splits data into complete messages, keeping only channel voice and SysEx.
  function parseMessages(data, sysexEnabled) {
    if (data === null || typeof data !== 'object') invalid('The data is not a sequence.');
    const messages = [];
    let message = null;
    let length = 0;
    // WebIDL sequence<unsigned long> conversion truncates; non-finite values become 0.
    for (const raw of Array.from(data, Number)) {
      const value = Number.isFinite(raw) ? Math.trunc(raw) : 0;
      if (value < 0 || value > 0xff) invalid(`The value ${value} is not a MIDI byte.`);
      if (value >= 0xf8) {
        if (value === 0xf9 || value === 0xfd) invalid('The data contains a reserved status byte.');
        continue; // Real-time messages may interleave anywhere; they are not relayed.
      }
      if (message) {
        if (value === 0xf7 && length === 0) {
          message.push(value);
          messages.push(message);
          message = null;
          continue;
        }
        if (value >= 0x80) invalid('The data contains an incomplete message.');
        message.push(value);
      } else {
        length = value >= 0x80 ? messageLength(value) : undefined;
        if (length === undefined) invalid('The data contains running status or an invalid status byte.');
        if (length === 0 && !sysexEnabled) {
          throw new DOMException('System exclusive message is not allowed.', 'InvalidAccessError');
        }
        message = [value];
      }
      if (length && message.length === length) {
        if (message[0] < 0xf0) messages.push(message);
        message = null;
      }
    }
    if (message) invalid('The data contains an incomplete message.');
    return messages;
  }

  class PortMap {
    #ports;
    constructor(ports) { this.#ports = new Map(ports.map(port => [port.id, port])); }
    get size() { return this.#ports.size; }
    get(id) { return this.#ports.get(id); }
    has(id) { return this.#ports.has(id); }
    keys() { return this.#ports.keys(); }
    values() { return this.#ports.values(); }
    entries() { return this.#ports.entries(); }
    forEach(callback, thisArg) { this.#ports.forEach((port, id) => callback.call(thisArg, port, id, this)); }
    [Symbol.iterator]() { return this.#ports.entries(); }
  }

  class MIDIOutput extends EventTarget {
    #sysexEnabled;
    #connection = 'closed';
    onstatechange = null;
    constructor(sysexEnabled) { super(); this.#sysexEnabled = sysexEnabled; }
    get id() { return 'effetune'; }
    get manufacturer() { return 'EffeTune'; }
    get name() { return 'EffeTune'; }
    get type() { return 'output'; }
    get version() { return ''; }
    get state() { return 'connected'; }
    get connection() { return this.#connection; }
    open() { this.#connection = 'open'; return Promise.resolve(this); }
    close() { this.#connection = 'closed'; return Promise.resolve(this); }
    send(data, timestamp = 0) {
      const time = Number(timestamp);
      if (!Number.isFinite(time)) invalid('The timestamp is not a finite number.');
      const messages = parseMessages(data, this.#sysexEnabled);
      this.#connection = 'open';
      // Relative delay: renderer processes do not share a monotonic clock.
      const now = performance.now();
      const delay = time > now ? time - now : 0;
      for (const message of messages) queue.push({ data: message, delay });
      if (queue.length && !flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    }
    clear() {
      queue = [];
      post({ clear: true });
    }
  }

  class MIDIAccess extends EventTarget {
    #inputs = new PortMap([]);
    #outputs;
    #sysexEnabled;
    onstatechange = null;
    constructor(sysexEnabled) {
      super();
      this.#sysexEnabled = sysexEnabled;
      this.#outputs = new PortMap([new MIDIOutput(sysexEnabled)]);
    }
    get inputs() { return this.#inputs; }
    get outputs() { return this.#outputs; }
    get sysexEnabled() { return this.#sysexEnabled; }
  }

  Object.defineProperty(Object.getPrototypeOf(navigator), 'requestMIDIAccess', {
    configurable: true, enumerable: true, writable: true,
    value: function requestMIDIAccess(options) {
      return Promise.resolve(new MIDIAccess(Boolean(options?.sysex)));
    }
  });

  // Pages that check the MIDI permission first see the virtual grant; other
  // permissions keep the original behavior.
  class MidiPermissionStatus extends EventTarget {
    name = 'midi';
    state = 'granted';
    onchange = null;
  }
  const permissionsPrototype = navigator.permissions ? Object.getPrototypeOf(navigator.permissions) : null;
  const originalQuery = permissionsPrototype?.query;
  if (typeof originalQuery === 'function') {
    Object.defineProperty(permissionsPrototype, 'query', {
      configurable: true, enumerable: true, writable: true,
      value: function query(descriptor) {
        if (descriptor?.name === 'midi') return Promise.resolve(new MidiPermissionStatus());
        return Reflect.apply(originalQuery, this, arguments);
      }
    });
  }
}

// Runs in the main world when the Browser setting opens MIDI files in the
// Music Player. Copies Standard MIDI Files that the page loads with fetch or
// XMLHttpRequest and posts them to the app; the page still receives the
// original, unchanged results. Serialized like installVirtualMidi.
function installMidiFileHook(post) {
  if (!['http:', 'https:', 'file:'].includes(location.protocol)) return;
  const MAX_BYTES = 4 * 1024 * 1024;
  const sizeOK = size => size >= 14 && size <= MAX_BYTES;

  function fileName(url) {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { return ''; }
  }

  function offer(bytes, url) {
    if (sizeOK(bytes.length) && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64) {
      post({ bytes: bytes.slice(), name: fileName(url) });
    }
  }

  function offerBuffer(value, url) {
    if (ArrayBuffer.isView(value)) offer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), url);
    else if (value) offer(new Uint8Array(value), url);
  }

  function offerBlob(blob, url) {
    if (!sizeOK(blob?.size)) return;
    blob.slice(0, 4).text().then(head => {
      if (head === 'MThd') return blob.arrayBuffer().then(buffer => offerBuffer(buffer, url));
    }).catch(() => {});
  }

  // Binary text from overrideMimeType('text/plain; charset=x-user-defined').
  function offerText(text, url) {
    if (typeof text !== 'string' || !sizeOK(text.length) || !text.startsWith('MThd') || text.includes('\ufffd')) return;
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index) & 0xff;
    offer(bytes, url);
  }

  function wrapBody(name, inspect) {
    const original = Response.prototype[name];
    if (typeof original !== 'function') return;
    Response.prototype[name] = function (...args) {
      const result = original.apply(this, args);
      try {
        const url = this.url;
        result.then(value => { try { inspect(value, url); } catch { /* Never disturb the page. */ } }, () => {});
      } catch { /* Never disturb the page. */ }
      return result;
    };
  }
  if (typeof Response === 'function') {
    wrapBody('arrayBuffer', offerBuffer);
    wrapBody('bytes', offerBuffer);
    wrapBody('blob', offerBlob);
  }

  function inspectRequest() {
    try {
      const url = this.responseURL;
      if (this.responseType === 'arraybuffer') offerBuffer(this.response, url);
      else if (this.responseType === 'blob') offerBlob(this.response, url);
      else if (this.responseType === '' || this.responseType === 'text') offerText(this.responseText, url);
    } catch { /* Never disturb the page. */ }
  }
  const send = typeof XMLHttpRequest === 'function' ? XMLHttpRequest.prototype.send : null;
  if (typeof send === 'function') {
    XMLHttpRequest.prototype.send = function (...args) {
      try { this.addEventListener('load', inspectRequest, { once: true }); } catch { /* Never disturb the page. */ }
      return send.apply(this, args);
    };
  }
}

// Runs in the main world of every page frame and posts the page's now-playing
// info to the app whenever it changes: Media Session metadata, plus the play
// state and position from the page's position state or its last active media
// element. Posts null once the info is gone. Serialized like installVirtualMidi.
function installMediaWatcher(post) {
  if (!['http:', 'https:'].includes(location.protocol) || typeof navigator === 'undefined') return;
  const POLL_MS = 500;
  const MAX_ARTWORK = 16;
  const session = navigator.mediaSession;
  const MediaElement = typeof HTMLMediaElement === 'function' ? HTMLMediaElement : null;
  let element = null;
  const watched = new WeakSet(); // Elements that have played outside the document.
  let positionState = null;
  let last = null;
  let lastKey = '';
  let lastTime = 0;

  function playing() {
    const state = session?.playbackState;
    if (state === 'playing' || state === 'paused') return state === 'playing';
    return Boolean(element && !element.paused && !element.ended);
  }

  function snapshot(now) {
    if (element && (element.muted || !element.currentSrc || (!element.isConnected && element.paused && !watched.has(element)))) element = null;
    const isPlaying = playing();
    if (positionState && positionState.playing !== isPlaying) {
      positionState.position = mediaPosition(now);
      positionState.time = now;
      positionState.playing = isPlaying;
    }
    const metadata = session?.metadata;
    if (!metadata && !element) return null;
    const value = {
      title: String(metadata?.title ?? ''), artist: String(metadata?.artist ?? ''), album: String(metadata?.album ?? ''),
      artwork: Array.from(metadata?.artwork ?? [], item => ({
        src: String(item?.src ?? ''), sizes: String(item?.sizes ?? ''), type: String(item?.type ?? '')
      })).slice(0, MAX_ARTWORK),
      playing: isPlaying, position: null, duration: null, rate: 1
    };
    if (positionState) {
      const { duration, rate } = positionState;
      Object.assign(value, { position: mediaPosition(now), duration, rate });
    } else if (element) {
      Object.assign(value, { position: element.currentTime, duration: element.duration, rate: element.playbackRate });
    }
    return value;
  }

  function mediaPosition(now) {
    const { position, playing, time, rate, duration } = positionState;
    return Math.max(0, Math.min(duration, position + (playing ? (now - time) / 1000 * rate : 0)));
  }

  // Posts when anything but the position changes, or when the position leaves the
  // course extrapolated from the last post by a second or more.
  function update() {
    const now = performance.now();
    let next;
    try { next = snapshot(now); } catch { return; }
    const key = next && JSON.stringify([next.title, next.artist, next.album, next.artwork, next.playing, next.duration, next.rate]);
    if (next && last && key === lastKey) {
      if ((next.position === null) === (last.position === null) && (next.position === null ||
        Math.abs(next.position - last.position - (last.playing ? (now - lastTime) / 1000 * last.rate : 0)) < 1)) return;
    } else if (!next && !last) return;
    last = next;
    lastKey = key;
    lastTime = now;
    post(next);
  }

  // Muted elements, such as autoplaying ads and hover previews, are never adopted; one is
  // adopted once unmuted while playing.
  function onMediaEvent(event) {
    const target = event.target;
    if (!MediaElement || !(target instanceof MediaElement)) return;
    if (!target.muted && (!element || event.type === 'play' || event.type === 'playing' ||
      (event.type === 'volumechange' && !target.paused))) element = target;
    update();
  }

  const MEDIA_EVENTS = ['play', 'playing', 'pause', 'ended', 'seeked', 'ratechange', 'durationchange', 'emptied', 'volumechange'];
  for (const type of MEDIA_EVENTS) document.addEventListener(type, onMediaEvent, true);

  // Elements outside the document, such as new Audio(), are watched once they play.
  const play = MediaElement?.prototype.play;
  if (typeof play === 'function') {
    MediaElement.prototype.play = function (...args) {
      try {
        if (!this.isConnected && !watched.has(this)) {
          watched.add(this);
          for (const type of MEDIA_EVENTS) this.addEventListener(type, onMediaEvent);
        }
        if (!this.muted) element = this;
      } catch { /* Never disturb the page. */ }
      return play.apply(this, args);
    };
  }

  const sessionPrototype = session ? Object.getPrototypeOf(session) : null;
  const setPositionState = sessionPrototype?.setPositionState;
  if (typeof setPositionState === 'function') {
    sessionPrototype.setPositionState = function (...args) {
      const result = setPositionState.apply(this, args);
      try {
        const state = args[0];
        positionState = state && Number.isFinite(state.duration) ? {
          position: Number(state.position ?? 0), duration: state.duration,
          rate: Number(state.playbackRate ?? 1), time: performance.now(), playing: playing()
        } : null;
        update();
      } catch { /* Never disturb the page. */ }
      return result;
    };
  }

  setInterval(update, POLL_MS);
}

contextBridge.executeInMainWorld({
  func: installVirtualMidi,
  args: [value => ipcRenderer.send('browser:midi', value)]
});

let midiFilesEnabled = false;
try { midiFilesEnabled = ipcRenderer.sendSync('browser:midi-files-enabled') === true; }
catch (error) { console.error('Browser MIDI file setting is unavailable:', error); }
if (midiFilesEnabled) {
  contextBridge.executeInMainWorld({
    func: installMidiFileHook,
    args: [value => ipcRenderer.send('browser:midi-file', value)]
  });
}

contextBridge.executeInMainWorld({
  func: installMediaWatcher,
  args: [value => ipcRenderer.send('browser:media', value)]
});

// A hidden fullscreen player leaves the rest of the page inert in Chromium.
// Observe only the fullscreen element, in the isolated world.
const fullscreenResize = new ResizeObserver(() => {
  const element = document.fullscreenElement;
  if (element && element.getClientRects().length === 0) {
    document.exitFullscreen().catch(error => {
      console.error('Browser hidden fullscreen exit failed:', error);
    });
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenResize.disconnect();
  if (document.fullscreenElement) fullscreenResize.observe(document.fullscreenElement);
});

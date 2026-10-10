import { openAssetLibraryBrowser, translateLibraryMessage } from '../ui/asset-library-browser.js';

function formatBadge(entry) {
  const channels = entry.channels
    ? translateLibraryMessage('irLibrary.badge.channels', '{count} ch', { count: entry.channels })
    : translateLibraryMessage('irLibrary.badge.channelsUnknown', 'channels unknown');
  const rate = entry.sampleRate
    ? `${Math.round(entry.sampleRate / 100) / 10} kHz`
    : translateLibraryMessage('irLibrary.badge.rateUnknown', 'rate unknown');
  const length = entry.frames && entry.sampleRate
    ? `${(entry.frames / entry.sampleRate).toFixed(2)} s`
    : translateLibraryMessage('irLibrary.badge.lengthUnknown', 'length unknown');
  const topologyLabels = {
    mono: ['irReverb.option.mono', 'Mono'],
    independent: ['irReverb.option.independent', 'Independent'],
    'true-stereo': ['irReverb.option.trueStereo', 'True Stereo'],
    matrix: ['irReverb.option.diagonalMatrix', 'Diagonal Matrix']
  };
  const topologyLabel = Object.prototype.hasOwnProperty.call(topologyLabels, entry.topology)
    ? topologyLabels[entry.topology]
    : null;
  const topology = topologyLabel
    ? translateLibraryMessage(topologyLabel[0], topologyLabel[1])
    : translateLibraryMessage('irLibrary.badge.topologyUnknown', 'unknown');
  return `${channels} · ${topology} · ${length} · ${rate}`;
}

function drawDecay(canvas, analysis) {
  const context = canvas.getContext?.('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const series = analysis?.edc;
  if (!series?.length) return;
  context.strokeStyle = window.ThemePalette?.get('graph-trace') ?? '';
  context.beginPath();
  for (let index = 0; index < series.length; index += 1) {
    const x = index / Math.max(1, series.length - 1) * canvas.width;
    const value = Math.max(-80, Math.min(0, series[index]));
    const y = -value / 80 * canvas.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

export function openIrLibraryBrowser({ service, ...options } = {}) {
  if (!service) throw new TypeError('IR library service is required.');
  return openAssetLibraryBrowser({
    ...options,
    readOnly: service.readOnly === true,
    service: {
      list: async options => (await service.list(options)).map(entry => ({ ...entry, id: entry.irId, name: entry.fileLabel })),
      delete: (id, options) => service.delete(id, options),
      importFiles: (files, options) => service.importFiles(files, options),
      importDirectory: (directory, options) => service.importDirectory(directory, options)
    },
    translate: (key, fallback, params) => translateLibraryMessage(`irLibrary.${key}`, fallback, params),
    formatBadge,
    decorateEntry(row, entry) {
      if (typeof service.readAnalysis !== 'function') return;
      const decay = document.createElement('canvas');
      decay.className = 'ir-library-decay';
      decay.width = 160;
      decay.height = 40;
      decay.setAttribute('aria-label', translateLibraryMessage('irLibrary.aria.decayPreview',
        'Decay preview for {name}', { name: entry.fileLabel }));
      row.appendChild(decay);
      service.readAnalysis(entry.irId).then(analysis => drawDecay(decay, analysis));
    },
    accept: 'audio/*,.wav,.wave,.aif,.aiff,.flac,.mp3,.ogg,.m4a,.irs'
  });
}

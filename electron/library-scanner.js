const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_SEEN_FILES_BATCH_SIZE = 500;
const MAX_SEEN_FILES_BATCH_SIZE = 2000;
const DEFAULT_BATCH_INTERVAL_MS = 500;
const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_BATCH_ARTWORK_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_ARTWORK_BYTES = DEFAULT_MAX_BATCH_ARTWORK_BYTES;
const DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_FOLDER_ARTWORK_CACHE_BYTES = DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES;
const MAX_READ_FILE_BYTES = 256 * 1024 * 1024;
const MAX_PARSE_QUEUE_SIZE = 1000;
const DEFAULT_PARSE_FILE_TIMEOUT_MS = 30000;
const MAX_PARSE_FILE_TIMEOUT_MS = 5 * 60 * 1000;

const SUPPORTED_AUDIO_EXTENSIONS = Object.freeze(['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm', 'mp4']);
const SUPPORTED_AUDIO_EXTENSION_SET = new Set(SUPPORTED_AUDIO_EXTENSIONS);
const RIFF_INFO_NATIVE_TAG_TYPE = 'riff-info';
const NATIVE_TAG_PRIORITY = ['matroska', 'vorbis', 'ID3v2.4', 'ID3v2.3', 'ID3v2.2', 'iTunes', 'asf', 'AIFF', 'APEv2', RIFF_INFO_NATIVE_TAG_TYPE, 'exif', 'ID3v1'];
const LOW_PRIORITY_TEXT_NATIVE_TAG_TYPES = new Set(['ID3v1']);
const TITLE_NATIVE_IDS = new Set(['TITLE', 'TIT2', 'TT2', 'INAM', 'TITL', '\u00A9NAM', 'WM/TITLE']);
const ARTIST_NATIVE_IDS = new Set(['ARTIST', 'ARTISTS', 'TPE1', 'TP1', 'IART', '\u00A9ART', 'AUTHOR', 'WM/AUTHOR']);
const ALBUM_ARTIST_NATIVE_IDS = new Set(['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST', 'ALBUMARTISTS', 'TPE2', 'TP2', 'AART', 'WM/ALBUMARTIST']);
const ALBUM_NATIVE_IDS = new Set(['ALBUM', 'TALB', 'TAL', 'IPRD', 'IRPD', '\u00A9ALB', 'WM/ALBUMTITLE']);
const GENRE_NATIVE_IDS = new Set(['GENRE', 'TCON', 'TCO', 'IGNR', '\u00A9GEN', 'WM/GENRE']);
const YEAR_NATIVE_IDS = new Set(['DATE', 'YEAR', 'ORIGINALDATE', 'ORIGINALYEAR', 'TDRC', 'TYER', 'TYE', 'TDAT', 'TORY', 'TDOR', 'TDRL', 'ICRD', '\u00A9DAY', 'WM/YEAR', 'WM/ORIGINALRELEASEYEAR']);
const TITLE_SORT_NATIVE_IDS = new Set(['TITLESORT', 'TITLE SORT', 'TITLE_SORT', 'SORTTITLE', 'SORT TITLE', 'TSOT', 'SONM']);
const ALBUM_SORT_NATIVE_IDS = new Set(['ALBUMSORT', 'ALBUM SORT', 'ALBUM_SORT', 'SORTALBUM', 'SORT ALBUM', 'TSOA', 'SOAL']);
const ALBUM_ARTIST_SORT_NATIVE_IDS = new Set(['ALBUMARTISTSORT', 'ALBUM ARTIST SORT', 'ALBUM_ARTIST_SORT', 'SORTALBUMARTIST', 'SORT ALBUM ARTIST', 'TSO2', 'SOAA']);
const COMPILATION_NATIVE_IDS = new Set(['COMPILATION', 'TCMP', 'TCP', 'CPIL', 'ITUNESCOMPILATION', 'WM/ISCOMPILATION']);
const TRACK_NATIVE_IDS = new Set(['PART_NUMBER', 'TRACK', 'TRACKNUMBER', 'TRCK', 'TRK', 'ITRK', 'IPRT', 'TRKN']);
const DISC_NATIVE_IDS = new Set(['TOTAL_PARTS', 'DISC', 'DISK', 'DISCNUMBER', 'DISKNUMBER', 'TPOS', 'TPA', 'DISKNUMBER']);
const SKIPPED_DIRECTORY_NAMES = new Set(['$recycle.bin', 'system volume information', 'node_modules']);
const ARTWORK_BASENAMES = Object.freeze(['cover', 'folder', 'front', 'album']);
const ARTWORK_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png', '.webp']);
const ARTWORK_EXTENSION_SET = new Set(ARTWORK_EXTENSIONS);
const RIFF_INFO_TAG_IDS = new Set(['IART', 'ICMT', 'ICOP', 'ICRD', 'IGNR', 'INAM', 'IPRD', 'IPRT', 'IRPD', 'ITRK', 'TITL', 'YEAR']);
const MAX_RIFF_SCAN_CHUNKS = 8192;
const MAX_RIFF_INFO_LIST_BYTES = 1024 * 1024;
const MAX_RIFF_INFO_VALUE_BYTES = 64 * 1024;
const LEGACY_METADATA_ENCODINGS = Object.freeze([
  { label: 'utf-8', script: 'unicode', minChars: 0 },
  { label: 'shift_jis', script: 'japanese', minChars: 2 },
  { label: 'euc-jp', script: 'japanese', minChars: 2 },
  { label: 'iso-2022-jp', script: 'japanese', minChars: 2 },
  { label: 'gbk', script: 'cjk', minChars: 2 },
  { label: 'gb18030', script: 'cjk', minChars: 2 },
  { label: 'big5', script: 'cjk', minChars: 2 },
  { label: 'euc-kr', script: 'hangul', minChars: 2 }
]);
const LANGUAGE_SPECIFIC_METADATA_ENCODINGS = Object.freeze([
  { label: 'windows-1251', script: 'cyrillic', minChars: 4, languages: ['ru', 'uk', 'bg', 'sr', 'mk', 'be'] },
  { label: 'koi8-r', script: 'cyrillic', minChars: 4, languages: ['ru', 'bg', 'sr', 'mk', 'be'] },
  { label: 'koi8-u', script: 'cyrillic', minChars: 4, languages: ['uk'] },
  { label: 'iso-8859-5', script: 'cyrillic', minChars: 4, languages: ['ru', 'uk', 'bg', 'sr', 'mk', 'be'] },
  { label: 'windows-1253', script: 'greek', minChars: 4, languages: ['el'] },
  { label: 'iso-8859-7', script: 'greek', minChars: 4, languages: ['el'] },
  { label: 'windows-1255', script: 'hebrew', minChars: 4, languages: ['he', 'iw'] },
  { label: 'iso-8859-8', script: 'hebrew', minChars: 4, languages: ['he', 'iw'] },
  { label: 'windows-1256', script: 'arabic', minChars: 4, languages: ['ar', 'fa', 'ur'] },
  { label: 'iso-8859-6', script: 'arabic', minChars: 4, languages: ['ar'] },
  { label: 'windows-874', script: 'thai', minChars: 4, languages: ['th'] }
]);
const LANGUAGE_SCRIPT_BY_CODE = Object.freeze({
  ar: 'arabic',
  be: 'cyrillic',
  bg: 'cyrillic',
  el: 'greek',
  fa: 'arabic',
  he: 'hebrew',
  hi: 'devanagari',
  iw: 'hebrew',
  ja: 'japanese',
  ko: 'hangul',
  mk: 'cyrillic',
  ru: 'cyrillic',
  sr: 'cyrillic',
  th: 'thai',
  uk: 'cyrillic',
  ur: 'arabic',
  zh: 'cjk'
});
const WINDOWS_1252_BYTES = new Map([
  ['\u20AC', 0x80],
  ['\u201A', 0x82],
  ['\u0192', 0x83],
  ['\u201E', 0x84],
  ['\u2026', 0x85],
  ['\u2020', 0x86],
  ['\u2021', 0x87],
  ['\u02C6', 0x88],
  ['\u2030', 0x89],
  ['\u0160', 0x8a],
  ['\u2039', 0x8b],
  ['\u0152', 0x8c],
  ['\u017D', 0x8e],
  ['\u2018', 0x91],
  ['\u2019', 0x92],
  ['\u201C', 0x93],
  ['\u201D', 0x94],
  ['\u2022', 0x95],
  ['\u2013', 0x96],
  ['\u2014', 0x97],
  ['\u02DC', 0x98],
  ['\u2122', 0x99],
  ['\u0161', 0x9a],
  ['\u203A', 0x9b],
  ['\u0153', 0x9c],
  ['\u017E', 0x9e],
  ['\u0178', 0x9f]
]);
const ISO_2022_JP_ESCAPE = String.fromCharCode(0x1b);
const WINDOWS_1252_MARKER_PATTERN = /[\u0080-\u009F\u0192\u201A\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018-\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;
const UTF8_MOJIBAKE_SEQUENCE_PATTERN = /(?:[ÃÂ][\u0080-\u00BF\u00A0-\u00BF]|â[\u0080-\u009F\u201A-\u201E\u20AC\u2122]|ã[\u0080-\u009F\u201A-\u201E])/g;
const LATIN1_SYMBOL_PATTERN = /[\u00A1-\u00BF\u00D7\u00F7]/;
const REPLACEMENT_CHAR_PATTERN = /\uFFFD/;
const COMMON_CJK_CHARACTERS = new Set(Array.from(
  '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联认六共权收证改清美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界'
));
const textDecoders = new Map();

let metadataModulePromise;
let metadataParserMode = 'direct';
const folderArtworkByteCacheStates = new WeakMap();

const metadataWorkerThreads = (() => {
  try {
    return require('worker_threads');
  } catch {
    return null;
  }
})();

let musicMetadataWorkerPath;

function getMusicMetadataWorkerPath() {
  if (musicMetadataWorkerPath !== undefined) return musicMetadataWorkerPath;
  try {
    musicMetadataWorkerPath = require.resolve('music-metadata');
  } catch {
    musicMetadataWorkerPath = null;
  }
  return musicMetadataWorkerPath;
}

const MUSIC_METADATA_PARSE_WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { pathToFileURL } = require('url');

const DEFAULT_MAX_ARTWORK_BYTES = ${MAX_ARTWORK_BYTES};
let parseFilePromise = null;

async function loadParseFile() {
  if (!parseFilePromise) {
    parseFilePromise = (async () => {
      if (workerData && workerData.musicMetadataPath) {
        const metadataModule = await import(pathToFileURL(workerData.musicMetadataPath).href);
        if (metadataModule && typeof metadataModule.parseFile === 'function') {
          return metadataModule.parseFile.bind(metadataModule);
        }
        if (metadataModule && metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
          return metadataModule.default.parseFile.bind(metadataModule.default);
        }
      }

      try {
        const metadataModule = require('music-metadata');
        if (metadataModule && typeof metadataModule.parseFile === 'function') {
          return metadataModule.parseFile.bind(metadataModule);
        }
        if (metadataModule && metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
          return metadataModule.default.parseFile.bind(metadataModule.default);
        }
      } catch (requireError) {
        if (requireError && requireError.code !== 'ERR_REQUIRE_ESM' && requireError.code !== 'MODULE_NOT_FOUND') {
          throw requireError;
        }
      }

      const metadataModule = await import('music-metadata');
      if (metadataModule && typeof metadataModule.parseFile === 'function') {
        return metadataModule.parseFile.bind(metadataModule);
      }
      if (metadataModule && metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
        return metadataModule.default.parseFile.bind(metadataModule.default);
      }
      throw new Error('music-metadata parseFile is unavailable');
    })();
  }
  return await parseFilePromise;
}

function serializeError(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    code: error && error.code ? error.code : undefined,
    message: error && error.message ? error.message : String(error || 'Unknown metadata parse error'),
    stack: error && error.stack ? error.stack : undefined
  };
}

function normalizeMaxArtworkBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_ARTWORK_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return DEFAULT_MAX_ARTWORK_BYTES;
  if (number > DEFAULT_MAX_ARTWORK_BYTES) return DEFAULT_MAX_ARTWORK_BYTES;
  return number;
}

function getBinaryByteLength(data) {
  if (!data) return 0;
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

function selectPicture(pictures) {
  if (!Array.isArray(pictures) || pictures.length === 0) return null;

  for (const picture of pictures) {
    const descriptor = \`\${picture.type || ''} \${picture.description || ''}\`.toLowerCase();
    if (descriptor.includes('front')) return picture;
  }

  return pictures[0];
}

function sanitizePictureForPostMessage(picture, maxArtworkBytes) {
  if (!picture || typeof picture !== 'object') return null;
  const byteLength = getBinaryByteLength(picture.data);
  if (byteLength <= 0 || byteLength > maxArtworkBytes) return null;
  return {
    type: picture.type,
    description: picture.description,
    format: picture.format,
    data: picture.data
  };
}

function sanitizeMetadataForPostMessage(metadata, message) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const sanitized = { ...metadata };
  const common = metadata.common && typeof metadata.common === 'object'
    ? { ...metadata.common }
    : {};
  const includeArtwork = message && message.options && message.options.skipCovers === false;
  if (includeArtwork) {
    const maxArtworkBytes = normalizeMaxArtworkBytes(message.maxArtworkBytes);
    const picture = sanitizePictureForPostMessage(selectPicture(common.picture), maxArtworkBytes);
    common.picture = picture ? [picture] : [];
  } else {
    common.picture = [];
  }
  sanitized.common = common;
  if (metadata.format && typeof metadata.format === 'object') {
    sanitized.format = { ...metadata.format };
  }
  return sanitized;
}

parentPort.on('message', async message => {
  if (!message || message.type !== 'parse') return;
  try {
    const parseFile = await loadParseFile();
    const metadata = await parseFile(message.path, message.options || {});
    parentPort.postMessage({ id: message.id, metadata: sanitizeMetadataForPostMessage(metadata, message) });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: serializeError(error) });
  }
});
`;

function createAbortError() {
  const error = new Error('Library scan canceled');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function isAbortError(error) {
  return Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}

function deserializeWorkerError(payload) {
  const error = new Error(payload && payload.message ? payload.message : 'Metadata parsing failed');
  if (payload && payload.name) error.name = payload.name;
  if (payload && payload.code) error.code = payload.code;
  if (payload && payload.stack) error.stack = payload.stack;
  return error;
}

function addAbortSignalOption(options, abortSignal) {
  const parseOptions = { ...options };
  if (abortSignal) {
    Object.defineProperty(parseOptions, 'abortSignal', {
      value: abortSignal,
      enumerable: false,
      configurable: true
    });
  }
  return parseOptions;
}

class MetadataParseWorkerPool {
  constructor({ maxWorkers = MAX_CONCURRENCY } = {}) {
    this.maxWorkers = maxWorkers;
    this.workers = new Set();
    this.idleWorkers = [];
    this.queue = [];
    this.nextJobId = 1;
  }

  run(candidate, options, signal, timeoutMs, maxArtworkBytes) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(createAbortError());
        return;
      }

      const job = {
        id: this.nextJobId,
        candidate,
        options,
        signal,
        timeoutMs,
        maxArtworkBytes,
        resolve,
        reject,
        worker: null,
        timeout: null,
        abort: null,
        settled: false
      };
      this.nextJobId += 1;

      if (signal && typeof signal.addEventListener === 'function') {
        job.abort = () => {
          const error = createAbortError();
          if (job.worker) {
            this.completeWorkerJob(job.worker, job, { error, terminate: true });
          } else {
            this.rejectQueuedJob(job, error);
          }
        };
        signal.addEventListener('abort', job.abort, { once: true });
      }

      this.queue.push(job);
      this.pump();
    });
  }

  pump() {
    while (this.queue.length > 0) {
      const worker = this.acquireWorker();
      if (!worker) return;
      const job = this.queue.shift();
      this.startWorkerJob(worker, job);
    }
  }

  acquireWorker() {
    while (this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop();
      if (this.workers.has(worker) && !worker.currentJob) return worker;
    }

    if (this.workers.size >= this.maxWorkers) return null;
    return this.createWorker();
  }

  createWorker() {
    if (!metadataWorkerThreads || typeof metadataWorkerThreads.Worker !== 'function') {
      throw new Error('Metadata parse workers are unavailable');
    }

    const worker = new metadataWorkerThreads.Worker(MUSIC_METADATA_PARSE_WORKER_SOURCE, {
      eval: true,
      workerData: {
        musicMetadataPath: getMusicMetadataWorkerPath()
      }
    });
    worker.currentJob = null;
    worker.on('message', message => this.handleWorkerMessage(worker, message));
    worker.on('error', error => this.handleWorkerFailure(worker, error));
    worker.on('exit', code => this.handleWorkerExit(worker, code));
    if (typeof worker.unref === 'function') {
      worker.unref();
    }
    this.workers.add(worker);
    return worker;
  }

  startWorkerJob(worker, job) {
    job.worker = worker;
    worker.currentJob = job;
    job.timeout = setTimeout(() => {
      this.completeWorkerJob(worker, job, {
        error: createParseTimeoutError(job.candidate, job.timeoutMs),
        terminate: true
      });
    }, job.timeoutMs);

    try {
      worker.postMessage({
        type: 'parse',
        id: job.id,
        path: job.candidate.path,
        options: job.options,
        maxArtworkBytes: job.maxArtworkBytes
      });
    } catch (error) {
      this.completeWorkerJob(worker, job, { error, terminate: true });
    }
  }

  handleWorkerMessage(worker, message) {
    const job = worker.currentJob;
    if (!job || job.id !== message?.id) return;
    if (message.error) {
      this.completeWorkerJob(worker, job, { error: deserializeWorkerError(message.error), terminate: false });
      return;
    }
    this.completeWorkerJob(worker, job, { metadata: message.metadata, terminate: false });
  }

  handleWorkerFailure(worker, error) {
    const job = worker.currentJob;
    this.discardWorker(worker);
    if (job && !job.settled) {
      this.rejectJob(job, error);
    }
    this.pump();
  }

  handleWorkerExit(worker, code) {
    const job = worker.currentJob;
    this.discardWorker(worker);
    if (job && !job.settled) {
      const error = new Error(`Metadata parse worker exited with code ${code}`);
      error.code = 'ERR_LIBRARY_PARSE_WORKER_EXIT';
      this.rejectJob(job, error);
    }
    this.pump();
  }

  completeWorkerJob(worker, job, { metadata = null, error = null, terminate = false } = {}) {
    if (!job || job.settled) return;
    job.settled = true;
    this.cleanupJob(job);
    if (worker.currentJob === job) {
      worker.currentJob = null;
    }

    if (terminate) {
      this.discardWorker(worker);
      this.terminateWorker(worker);
    } else if (this.workers.has(worker)) {
      this.idleWorkers.push(worker);
    }

    if (error) {
      job.reject(error);
    } else {
      job.resolve(metadata);
    }
    this.pump();
  }

  rejectQueuedJob(job, error) {
    if (!job || job.settled) return;
    const index = this.queue.indexOf(job);
    if (index !== -1) this.queue.splice(index, 1);
    this.rejectJob(job, error);
  }

  rejectJob(job, error) {
    if (!job || job.settled) return;
    job.settled = true;
    this.cleanupJob(job);
    job.reject(error);
  }

  cleanupJob(job) {
    if (job.timeout) {
      clearTimeout(job.timeout);
      job.timeout = null;
    }
    if (job.abort && job.signal && typeof job.signal.removeEventListener === 'function') {
      job.signal.removeEventListener('abort', job.abort);
    }
    job.abort = null;
    job.worker = null;
  }

  discardWorker(worker) {
    this.workers.delete(worker);
    this.idleWorkers = this.idleWorkers.filter(idleWorker => idleWorker !== worker);
  }

  terminateWorker(worker) {
    try {
      const result = worker.terminate();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Worker termination is best effort once a parse has already timed out.
    }
  }
}

let metadataParseWorkerPool = null;

function getMetadataParseWorkerPool() {
  if (!metadataWorkerThreads || typeof metadataWorkerThreads.Worker !== 'function') return null;
  if (!metadataParseWorkerPool) {
    metadataParseWorkerPool = new MetadataParseWorkerPool({ maxWorkers: MAX_CONCURRENCY });
  }
  return metadataParseWorkerPool;
}

async function loadMusicMetadata() {
  if (!metadataModulePromise) {
    metadataModulePromise = (async () => {
      try {
        const metadataModule = require('music-metadata');
        metadataParserMode = 'direct';
        return metadataModule;
      } catch (requireError) {
        if (requireError && requireError.code !== 'ERR_REQUIRE_ESM' && requireError.code !== 'MODULE_NOT_FOUND') {
          return null;
        }

        try {
          const metadataModule = await import('music-metadata');
          metadataParserMode = 'worker';
          return metadataModule;
        } catch {
          metadataParserMode = 'direct';
          return null;
        }
      }
    })();
  }

  return await metadataModulePromise;
}

function getParseFile(metadataModule) {
  if (!metadataModule) return null;
  if (typeof metadataModule.parseFile === 'function') return metadataModule.parseFile.bind(metadataModule);
  if (metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
    return metadataModule.default.parseFile.bind(metadataModule.default);
  }
  return null;
}

function normalizeConcurrency(value) {
  if (!Number.isInteger(value)) return DEFAULT_CONCURRENCY;
  if (value < 1) return 1;
  if (value > MAX_CONCURRENCY) return MAX_CONCURRENCY;
  return value;
}

function normalizeBatchSize(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_BATCH_SIZE;
  if (value > MAX_BATCH_SIZE) return MAX_BATCH_SIZE;
  return value;
}

function normalizeSeenFilesBatchSize(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_SEEN_FILES_BATCH_SIZE;
  if (value > MAX_SEEN_FILES_BATCH_SIZE) return MAX_SEEN_FILES_BATCH_SIZE;
  return value;
}

function normalizeBatchIntervalMs(value) {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_BATCH_INTERVAL_MS;
  return value;
}

function normalizeMaxBatchArtworkBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_BATCH_ARTWORK_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return DEFAULT_MAX_BATCH_ARTWORK_BYTES;
  if (number > MAX_BATCH_ARTWORK_BYTES) return MAX_BATCH_ARTWORK_BYTES;
  return number;
}

function normalizeMaxFolderArtworkCacheBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES;
  if (number > MAX_FOLDER_ARTWORK_CACHE_BYTES) return MAX_FOLDER_ARTWORK_CACHE_BYTES;
  return number;
}

function normalizeMaxArtworkBytes(value) {
  if (value === undefined || value === null) return MAX_ARTWORK_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return MAX_ARTWORK_BYTES;
  if (number > MAX_ARTWORK_BYTES) return MAX_ARTWORK_BYTES;
  return number;
}

function normalizeParseFileTimeoutMs(value) {
  if (value === undefined || value === null) return DEFAULT_PARSE_FILE_TIMEOUT_MS;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return DEFAULT_PARSE_FILE_TIMEOUT_MS;
  if (number > MAX_PARSE_FILE_TIMEOUT_MS) return MAX_PARSE_FILE_TIMEOUT_MS;
  return Math.floor(number);
}

function normalizeRoot(root) {
  if (!root || typeof root.path !== 'string' || root.path.trim() === '') {
    throw new Error('Library scan root requires a path');
  }

  const rootPath = path.resolve(root.path);
  return {
    folderId: String(root.folderId || root.id || rootPath),
    path: rootPath
  };
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('Library scan requires at least one root');
  }

  return roots.map(normalizeRoot);
}

function normalizeRelativePath(relativePath) {
  return String(relativePath || '').replace(/[\\/]+/g, '/');
}

function getKnownFileKey(folderId, relativePath) {
  return `${folderId}\0${normalizeRelativePath(relativePath)}`;
}

function createKnownFileMap(knownFiles) {
  const knownFileMap = new Map();
  if (!Array.isArray(knownFiles)) return knownFileMap;

  for (const file of knownFiles) {
    if (!file || typeof file.relativePath !== 'string') continue;
    const folderId = String(file.folderId || '');
    if (!folderId) continue;
    knownFileMap.set(getKnownFileKey(folderId, file.relativePath), {
      size: Number(file.size),
      mtimeMs: Number(file.mtimeMs)
    });
  }

  return knownFileMap;
}

function hasSameFileStat(knownFile, candidate) {
  if (!knownFile) return false;
  return Number.isFinite(knownFile.size) &&
    Number.isFinite(knownFile.mtimeMs) &&
    knownFile.size === candidate.size &&
    knownFile.mtimeMs === candidate.mtimeMs;
}

function getAudioExtension(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

function isSupportedAudioFile(filePath) {
  return SUPPORTED_AUDIO_EXTENSION_SET.has(getAudioExtension(filePath));
}

function shouldSkipDirectory(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

function classifyFsError(error) {
  const code = error && error.code ? error.code : 'UNKNOWN';
  if (code === 'ENOENT') return 'missing';
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOTDIR') return 'not-directory';
  return 'filesystem-error';
}

function toErrorPayload(error) {
  return {
    code: error && error.code ? error.code : 'UNKNOWN',
    reason: error && error.message ? error.message : String(error || 'Unknown error'),
    category: classifyFsError(error)
  };
}

async function assertReadableDirectory(root, signal) {
  throwIfAborted(signal);
  const stat = await fs.promises.stat(root.path);
  throwIfAborted(signal);
  if (!stat.isDirectory()) {
    const error = new Error(`${root.path} is not a directory`);
    error.code = 'ENOTDIR';
    throw error;
  }
  await fs.promises.access(root.path, fs.constants.R_OK);
}

async function emitToSink(sink, event) {
  if (!sink) return;
  if (typeof sink === 'function') {
    await sink(event);
  } else if (typeof sink.emit === 'function') {
    await sink.emit(event);
  }
}

async function* enumerateAudioFiles(root, signal) {
  const stack = [''];

  while (stack.length > 0) {
    throwIfAborted(signal);
    const relativeDir = stack.pop();
    const absoluteDir = relativeDir ? path.join(root.path, relativeDir) : root.path;
    let directory;

    try {
      directory = await fs.promises.opendir(absoluteDir);
    } catch (error) {
      yield {
        type: 'directory-error',
        folderId: root.folderId,
        path: absoluteDir,
        relativePath: normalizeRelativePath(relativeDir),
        error
      };
      continue;
    }

    try {
      for await (const dirent of directory) {
        throwIfAborted(signal);
        if (!dirent || dirent.isSymbolicLink()) continue;

        const childRelativePath = relativeDir ? path.join(relativeDir, dirent.name) : dirent.name;
        const childAbsolutePath = path.join(root.path, childRelativePath);

        if (dirent.isDirectory()) {
          if (!shouldSkipDirectory(dirent.name)) {
            stack.push(childRelativePath);
          }
          continue;
        }

        if (!dirent.isFile() || !isSupportedAudioFile(dirent.name)) continue;

        try {
          const stat = await fs.promises.stat(childAbsolutePath);
          throwIfAborted(signal);
          if (!stat.isFile()) continue;
          const relativePath = normalizeRelativePath(childRelativePath);
          yield {
            type: 'file',
            folderId: root.folderId,
            rootPath: root.path,
            path: childAbsolutePath,
            relativePath,
            fileName: path.basename(childAbsolutePath),
            ext: getAudioExtension(childAbsolutePath),
            size: stat.size,
            mtimeMs: stat.mtimeMs
          };
        } catch (error) {
          yield {
            type: 'file-error',
            folderId: root.folderId,
            path: childAbsolutePath,
            relativePath: normalizeRelativePath(childRelativePath),
            error
          };
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      yield {
        type: 'directory-error',
        folderId: root.folderId,
        path: absoluteDir,
        relativePath: normalizeRelativePath(relativeDir),
        error
      };
    }
  }
}

function createTrackId(folderId, relativePath) {
  return `t_${crypto
    .createHash('sha1')
    .update(String(folderId))
    .update('\0')
    .update(normalizeRelativePath(relativePath))
    .digest('hex')
    .slice(0, 20)}`;
}

function toArrayBuffer(buffer) {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) return buffer.slice(0);
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const copiedBuffer = Buffer.from(buffer);
  return copiedBuffer.buffer.slice(copiedBuffer.byteOffset, copiedBuffer.byteOffset + copiedBuffer.byteLength);
}

function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

function getBinaryByteLength(data) {
  if (!data) return 0;
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

function createArtworkIdFromBytes(bytes) {
  return `art_${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 24)}`;
}

function createFolderArtworkCache(maxBytes) {
  const cache = new Map();
  configureFolderArtworkCache(cache, maxBytes);
  return cache;
}

function configureFolderArtworkCache(cache, maxBytes) {
  const byteBudget = normalizeMaxFolderArtworkCacheBytes(maxBytes);
  let state = folderArtworkByteCacheStates.get(cache);
  if (!state) {
    state = {
      maxBytes: byteBudget,
      bytes: 0,
      entries: new Map()
    };
    folderArtworkByteCacheStates.set(cache, state);
    return cache;
  }

  state.maxBytes = byteBudget;
  evictFolderArtworkByteCache(state);
  return cache;
}

function prepareFolderArtworkCache(cache, maxBytes) {
  const artworkCache = cache || new Map();
  if (maxBytes === undefined || maxBytes === null) {
    if (!folderArtworkByteCacheStates.has(artworkCache)) {
      configureFolderArtworkCache(artworkCache, DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES);
    }
  } else {
    configureFolderArtworkCache(artworkCache, maxBytes);
  }
  return artworkCache;
}

function getFolderArtworkByteCacheState(cache) {
  if (!folderArtworkByteCacheStates.has(cache)) {
    configureFolderArtworkCache(cache, DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES);
  }
  return folderArtworkByteCacheStates.get(cache);
}

function removeFolderArtworkByteEntry(state, key, expectedEntry = null) {
  const entry = state.entries.get(key);
  if (!entry || (expectedEntry && entry !== expectedEntry)) return;
  state.entries.delete(key);
  if (entry.byteLength > 0) {
    state.bytes -= entry.byteLength;
    if (state.bytes < 0) state.bytes = 0;
  }
}

function evictFolderArtworkByteCache(state) {
  while (state.bytes > state.maxBytes && state.entries.size > 0) {
    const oldestKey = state.entries.keys().next().value;
    if (oldestKey === undefined) break;
    removeFolderArtworkByteEntry(state, oldestKey);
  }
}

function getCachedFolderArtworkPromise(cache, key) {
  const state = getFolderArtworkByteCacheState(cache);
  const entry = state.entries.get(key);
  if (!entry) return null;
  state.entries.delete(key);
  state.entries.set(key, entry);
  return entry.promise;
}

function cacheFolderArtworkPromise(cache, key, promise) {
  const state = getFolderArtworkByteCacheState(cache);
  removeFolderArtworkByteEntry(state, key);
  const entry = {
    promise,
    byteLength: 0
  };
  state.entries.set(key, entry);

  promise.then(
    artwork => {
      const buffer = artwork ? normalizeArtworkBuffer(artwork.buffer) : null;
      const byteLength = buffer ? buffer.byteLength : 0;
      if (byteLength <= 0 || byteLength > state.maxBytes) {
        removeFolderArtworkByteEntry(state, key, entry);
        return;
      }
      if (state.entries.get(key) !== entry) return;
      entry.byteLength = byteLength;
      state.bytes += byteLength;
      state.entries.delete(key);
      state.entries.set(key, entry);
      evictFolderArtworkByteCache(state);
    },
    () => {
      removeFolderArtworkByteEntry(state, key, entry);
    }
  );
}

function normalizeArtworkBuffer(data, maxBytes = MAX_ARTWORK_BYTES) {
  const artworkByteLimit = normalizeMaxArtworkBytes(maxBytes);
  const byteLength = getBinaryByteLength(data);
  if (byteLength <= 0 || byteLength > artworkByteLimit) return null;
  const buffer = toBuffer(data);
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength > artworkByteLimit) return null;
  return buffer;
}

function repairLegacyMetadataMojibake(text, languageHints = null) {
  if (typeof text !== 'string' || text === '') return text;
  const originalScore = scoreDecodedText(text);
  if (!mayContainLegacyMetadataMojibake(text, originalScore)) return text;

  const bytes = recoverSingleByteText(text);
  if (!bytes) return text;

  const languageCodes = getLanguageCodes(languageHints);
  const languageScripts = getLanguageScripts(languageCodes);
  const contextTexts = getContextTexts(languageHints);
  const contextScripts = getContextScriptsFromTexts(contextTexts);
  const repairContext = { languageScripts, contextScripts, contextTexts };
  const candidates = [];
  let bestScore = originalScore;
  let bestEncodingScript = null;

  for (const encoding of getLegacyMetadataEncodings(languageCodes)) {
    if (bestEncodingScript === 'unicode' && encoding.script !== 'unicode'
      && bestScore.suspicious === 0 && getDominantNonLatinScriptScore(bestScore) > 0) {
      continue;
    }
    const decoded = decodeBytes(bytes, encoding.label);
    if (!decoded || decoded === text) continue;
    const decodedScore = scoreDecodedText(decoded);
    const repairScore = scoreRepairCandidate(originalScore, bestScore, decodedScore, encoding, repairContext, decoded);
    if (repairScore > 0) {
      candidates.push({ text: decoded, score: decodedScore, repairScore, encoding });
    }
    if (repairScore > 0 && isBetterIntermediateScore(decodedScore, bestScore, encoding, bestEncodingScript)) {
      bestScore = decodedScore;
      bestEncodingScript = encoding.script;
    }
  }

  return chooseRepairCandidate(text, candidates, repairContext);
}

function decodeLegacyMetadataBytes(data, languageHints = null) {
  const rawBytes = normalizeByteArray(data);
  if (!rawBytes || rawBytes.length === 0) return '';

  const utf16Text = decodeLikelyUtf16Bytes(rawBytes);
  if (utf16Text) return utf16Text;

  const bytes = trimSingleByteNullTerminators(rawBytes);
  if (bytes.length === 0) return '';

  const latin1Text = bytesToLatin1String(bytes);
  const repaired = repairLegacyMetadataMojibake(latin1Text, languageHints);
  if (repaired !== latin1Text) return repaired.trim();

  const latin1Score = scoreDecodedText(latin1Text);
  const windows1252Text = decodeBytes(bytes, 'windows-1252');
  if (windows1252Text && windows1252Text !== latin1Text) {
    const windows1252Score = scoreDecodedText(windows1252Text);
    if (latin1Score.controls > 0 &&
      windows1252Score.controls === 0 &&
      windows1252Score.windowsMarkers === 0 &&
      windows1252Score.replacements === 0) {
      return windows1252Text.trim();
    }
  }

  return latin1Text.trim();
}

function mayContainLegacyMetadataMojibake(text, score) {
  if (text.includes(ISO_2022_JP_ESCAPE) || score.controls > 0 || score.replacements > 0) return true;
  if (score.windowsMarkers > 0 || score.utf8Markers > 0 || score.latinSymbols >= 2) return true;
  return score.highLatin >= 4 && score.highLatin / score.length >= 0.45;
}

function getLegacyMetadataEncodings(languageCodes) {
  const encodings = [...LEGACY_METADATA_ENCODINGS];
  if (!languageCodes.size) return encodings;
  const labels = new Set(encodings.map(encoding => encoding.label));
  for (const encoding of LANGUAGE_SPECIFIC_METADATA_ENCODINGS) {
    if (labels.has(encoding.label)) continue;
    if (!encoding.languages.some(language => languageCodes.has(language))) continue;
    labels.add(encoding.label);
    encodings.push(encoding);
  }
  return encodings;
}

function getLanguageCodes(languageHints) {
  const codes = new Set();
  if (typeof languageHints === 'string') {
    addLanguageCode(codes, languageHints);
    return codes;
  }
  if (!languageHints || typeof languageHints !== 'object') return codes;

  const languagePreference = normalizeLanguageCode(languageHints.languagePreference);
  if (languagePreference && languagePreference !== 'auto') {
    codes.add(languagePreference);
    return codes;
  }

  const language = normalizeLanguageCode(languageHints.language);
  if (language && language !== 'en') {
    codes.add(language);
    return codes;
  }

  const browserLanguage = normalizeLanguageCode(languageHints.browserLanguage || languageHints.locale);
  if (browserLanguage) {
    codes.add(browserLanguage);
    return codes;
  }

  for (const field of ['browserLanguages', 'languages']) {
    const languageList = Array.isArray(languageHints[field]) ? languageHints[field] : [];
    const firstLanguage = languageList.slice(0, 8).map(normalizeLanguageCode).find(Boolean);
    if (firstLanguage) {
      codes.add(firstLanguage);
      return codes;
    }
  }

  if (language) codes.add(language);
  return codes;
}

function addLanguageCode(codes, value) {
  const code = normalizeLanguageCode(value);
  if (code) codes.add(code);
}

function normalizeLanguageCode(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return '';
  const code = normalized.split('-')[0];
  return /^[a-z]{2,3}$/.test(code) ? code : '';
}

function getLanguageScripts(languageCodes) {
  const scripts = new Set();
  for (const code of languageCodes) {
    const script = LANGUAGE_SCRIPT_BY_CODE[code];
    if (script) scripts.add(script);
  }
  return scripts;
}

function getContextScriptsFromTexts(contextTexts) {
  const scripts = new Set();
  for (const text of contextTexts) {
    const score = scoreDecodedText(text);
    if (score.japanese > 0) scripts.add('japanese');
    if (score.hangul > 0) scripts.add('hangul');
    if (score.cyrillic > 0) scripts.add('cyrillic');
    if (score.greek > 0) scripts.add('greek');
    if (score.hebrew > 0) scripts.add('hebrew');
    if (score.arabic > 0) scripts.add('arabic');
    if (score.thai > 0) scripts.add('thai');
    if (score.devanagari > 0) scripts.add('devanagari');
    if (score.cjk > 0 && score.japanese === 0) scripts.add('cjk');
  }
  return scripts;
}

function getContextTexts(languageHints) {
  if (!languageHints || typeof languageHints !== 'object') return [];
  const texts = [];
  for (const field of ['referenceText', 'title', 'fileName', 'relativePath', 'path']) {
    if (typeof languageHints[field] === 'string') texts.push(languageHints[field]);
  }
  for (const field of ['referenceTexts', 'contextTexts']) {
    if (!Array.isArray(languageHints[field])) continue;
    for (const text of languageHints[field]) {
      if (typeof text === 'string') texts.push(text);
    }
  }
  return texts.map(text => text.trim()).filter(Boolean);
}

function recoverSingleByteText(text) {
  const bytes = [];
  for (const character of text) {
    const mapped = WINDOWS_1252_BYTES.get(character);
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    const code = character.charCodeAt(0);
    if (code > 0xff) return null;
    bytes.push(code);
  }
  return Uint8Array.from(bytes);
}

function normalizeByteArray(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  return null;
}

function trimSingleByteNullTerminators(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end -= 1;
  return bytes.subarray(0, end);
}

function bytesToLatin1String(bytes) {
  const chunks = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return chunks.join('');
}

function decodeLikelyUtf16Bytes(bytes) {
  const bomEncoding = getUtf16BomEncoding(bytes);
  if (bomEncoding) {
    return cleanupDecodedMetadataText(decodeUtf16Bytes(bytes.subarray(2), bomEncoding));
  }

  if (bytes.length < 4) return '';
  const pairs = Math.floor(bytes.length / 2);
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    if (bytes[index] === 0x00) evenZeros += 1;
    if (bytes[index + 1] === 0x00) oddZeros += 1;
  }

  const evenRatio = evenZeros / pairs;
  const oddRatio = oddZeros / pairs;
  if (oddRatio >= 0.35 && evenRatio <= 0.1) {
    return cleanupDecodedMetadataText(decodeUtf16Bytes(bytes, 'utf-16le'));
  }
  if (evenRatio >= 0.35 && oddRatio <= 0.1) {
    return cleanupDecodedMetadataText(decodeUtf16Bytes(bytes, 'utf-16be'));
  }
  return '';
}

function getUtf16BomEncoding(bytes) {
  if (bytes.length < 2) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return '';
}

function decodeUtf16Bytes(bytes, encoding) {
  const chars = [];
  const chunk = [];
  const littleEndian = encoding === 'utf-16le';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1];
    chunk.push(code);
    if (chunk.length >= 0x8000) {
      chars.push(String.fromCharCode(...chunk));
      chunk.length = 0;
    }
  }
  if (chunk.length > 0) chars.push(String.fromCharCode(...chunk));
  return chars.join('');
}

function cleanupDecodedMetadataText(text) {
  const value = String(text || '');
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x00) end -= 1;
  const cleaned = value.slice(0, end).trim();
  if (!cleaned) return '';
  const score = scoreDecodedText(cleaned);
  return score.controls === 0 && score.replacements === 0 ? cleaned : '';
}

function decodeBytes(bytes, encoding) {
  const decoder = getTextDecoder(encoding);
  if (!decoder) return '';
  try {
    return decoder.decode(bytes).trim();
  } catch (_) {
    return '';
  }
}

function getTextDecoder(encoding) {
  if (textDecoders.has(encoding)) return textDecoders.get(encoding);
  let decoder = null;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch (_) {
    decoder = null;
  }
  textDecoders.set(encoding, decoder);
  return decoder;
}

function scoreDecodedText(text) {
  const score = {
    length: 0,
    letters: 0,
    latin: 0,
    asciiLatin: 0,
    highLatin: 0,
    windowsMarkers: 0,
    utf8Markers: countUtf8MojibakeMarkers(text),
    latinSymbols: 0,
    controls: 0,
    replacements: 0,
    japanese: 0,
    cjk: 0,
    hangul: 0,
    cyrillic: 0,
    greek: 0,
    hebrew: 0,
    arabic: 0,
    thai: 0,
    devanagari: 0,
    privateUse: 0,
    cjkCompatibility: 0,
    commonCjk: 0,
    cjkMojibakeArtifacts: 0,
    suspicious: 0
  };

  for (const character of text) {
    const code = character.codePointAt(0);
    score.length += 1;
    if (code >= 0x80 && code <= 0xff) score.highLatin += 1;
    if (WINDOWS_1252_MARKER_PATTERN.test(character) || character === ISO_2022_JP_ESCAPE) score.windowsMarkers += 1;
    if (LATIN1_SYMBOL_PATTERN.test(character)) score.latinSymbols += 1;
    if (REPLACEMENT_CHAR_PATTERN.test(character)) score.replacements += 1;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)) {
      score.controls += 1;
    }

    if (isAsciiLatin(code)) {
      score.asciiLatin += 1;
      score.latin += 1;
      score.letters += 1;
    } else if (isLatinLetter(code)) {
      score.latin += 1;
      score.letters += 1;
    } else if (isJapanese(code)) {
      score.japanese += 1;
      score.letters += 1;
    } else if (isCjkCompatibility(code)) {
      score.cjk += 1;
      score.cjkCompatibility += 1;
      if (isCommonCjk(code)) score.commonCjk += 1;
      if (isCjkMojibakeArtifact(code)) score.cjkMojibakeArtifacts += 1;
      score.letters += 1;
    } else if (isCjk(code)) {
      score.cjk += 1;
      if (isCommonCjk(code)) score.commonCjk += 1;
      if (isCjkMojibakeArtifact(code)) score.cjkMojibakeArtifacts += 1;
      score.letters += 1;
    } else if (isHangul(code)) {
      score.hangul += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0400, 0x052f)) {
      score.cyrillic += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0370, 0x03ff)) {
      score.greek += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0590, 0x05ff)) {
      score.hebrew += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0600, 0x06ff) || isInRange(code, 0x0750, 0x077f)) {
      score.arabic += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0e00, 0x0e7f)) {
      score.thai += 1;
      score.letters += 1;
    } else if (isInRange(code, 0x0900, 0x097f)) {
      score.devanagari += 1;
      score.letters += 1;
    } else if (isPrivateUse(code)) {
      score.privateUse += 1;
    }
  }

  score.suspicious = score.windowsMarkers + score.utf8Markers + score.latinSymbols + score.controls * 2 +
    score.replacements * 5 + score.privateUse * 4;
  return score;
}

function scoreRepairCandidate(originalScore, bestScore, decodedScore, encoding, repairContext, decodedText = '') {
  if (decodedScore.replacements > 0 || decodedScore.controls > 0 || decodedScore.privateUse > 0) return 0;
  if (encoding.script === 'unicode') {
    return scoreUnicodeRepair(originalScore, bestScore, decodedScore);
  }
  return scoreScriptRepair(originalScore, bestScore, decodedScore, encoding, repairContext, decodedText);
}

function countUtf8MojibakeMarkers(text) {
  return text.match(UTF8_MOJIBAKE_SEQUENCE_PATTERN)?.length || 0;
}

function scoreUnicodeRepair(originalScore, bestScore, decodedScore) {
  const suspiciousGain = originalScore.suspicious - decodedScore.suspicious;
  const scriptGain = getDominantNonLatinScriptScore(decodedScore) - getDominantNonLatinScriptScore(originalScore);
  if (originalScore.utf8Markers === 0 && scriptGain <= 0) return 0;
  if (suspiciousGain <= 0 && scriptGain <= 0) return 0;
  if (decodedScore.suspicious > bestScore.suspicious && scriptGain <= 0) return 0;
  return 100 + suspiciousGain * 20 + scriptGain * 8 + decodedScore.letters;
}

function scoreScriptRepair(originalScore, bestScore, decodedScore, encoding, repairContext, decodedText = '') {
  const target = getScriptScore(decodedScore, encoding.script);
  const originalTarget = getScriptScore(originalScore, encoding.script);
  const contextTextBonus = getContextTextBonus(decodedText, repairContext);
  const hasStrongContextMatch = contextTextBonus >= 220;
  if (target <= originalTarget && !hasStrongContextMatch) return 0;
  if (target < encoding.minChars && contextTextBonus <= 0) return 0;
  if (encoding.script !== 'unicode' && !hasStrongMultibyteMojibakeSignal(originalScore)) return 0;
  if (getDecodedCorruptionScore(decodedScore) > 0) return 0;
  const targetRatio = getScriptRatio(decodedScore, encoding.script);
  if (targetRatio < 0.45 && !hasStrongContextMatch) return 0;
  if (target < 4 && decodedScore.asciiLatin > 0 && !hasTextScriptContext(repairContext, encoding.script) && !hasStrongContextMatch) return 0;
  const suspiciousGain = originalScore.suspicious - decodedScore.suspicious;
  const highLatinGain = originalScore.highLatin - decodedScore.highLatin;
  const multibyteBonus = getMultibyteScriptBonus(originalScore, decodedScore, encoding.script);
  const bestTarget = getScriptScore(bestScore, encoding.script);
  if (target < bestTarget && getDecodedCorruptionScore(decodedScore) >= getDecodedCorruptionScore(bestScore)) return 0;
  return 80 + target * 8 + targetRatio * 20 + suspiciousGain * 10 + highLatinGain * 2
    + multibyteBonus + getScriptPriorityBonus(decodedScore, encoding.script)
    + contextTextBonus
    + getScriptContextBonus(repairContext, encoding.script, decodedScore)
    + getEncodingPriorityBonus(encoding, repairContext)
    - getScriptArtifactPenalty(decodedScore, encoding.script);
}

function chooseRepairCandidate(originalText, candidates, repairContext) {
  if (!candidates.length) return originalText;
  const sorted = [...candidates].sort((a, b) => b.repairScore - a.repairScore);
  const best = sorted[0];
  const second = sorted[1] || null;
  if (best.repairScore < 90) return originalText;
  if (isAmbiguousEastAsianRepair(best, second, repairContext)) return originalText;
  return best.text;
}

function isBetterIntermediateScore(candidateScore, bestScore, encoding, bestEncodingScript) {
  if (getDecodedCorruptionScore(candidateScore) < getDecodedCorruptionScore(bestScore)) return true;
  if (getDominantNonLatinScriptScore(candidateScore) > getDominantNonLatinScriptScore(bestScore)) return true;
  return !bestEncodingScript && encoding.script === 'unicode';
}

function isAmbiguousEastAsianRepair(best, second, repairContext) {
  if (!second) return false;
  const bestScript = best.encoding.script;
  const secondScript = second.encoding.script;
  if (!isAmbiguousEastAsianScript(bestScript) || !isAmbiguousEastAsianScript(secondScript)) return false;
  if (bestScript === secondScript) return false;
  if (best.repairScore - second.repairScore > 50) return false;
  if (hasTextScriptContext(repairContext, bestScript)) return false;
  return !hasDistinctiveScriptEvidence(best.score, bestScript);
}

function isAmbiguousEastAsianScript(script) {
  return script === 'japanese' || script === 'cjk';
}

function hasDistinctiveScriptEvidence(score, script) {
  if (script === 'japanese') return score.japanese > 0;
  if (script === 'cjk') {
    return score.cjk >= 2 && score.cjkMojibakeArtifacts === 0 &&
      score.commonCjk / Math.max(1, score.cjk) >= 0.55;
  }
  if (script === 'hangul') return score.hangul > 0;
  return false;
}

function getDecodedCorruptionScore(score) {
  return score.controls * 2 + score.replacements * 5 + score.privateUse * 4;
}

function getScriptRatio(score, script) {
  const target = getScriptScore(score, script);
  if (isMultibyteScript(script)) {
    const nonLatinLetters = score.letters - score.latin;
    return target / Math.max(1, nonLatinLetters);
  }
  return target / Math.max(1, score.letters);
}

function getDominantNonLatinScriptScore(score) {
  return Math.max(
    score.japanese,
    score.cjk,
    score.hangul,
    score.cyrillic,
    score.greek,
    score.hebrew,
    score.arabic,
    score.thai,
    score.devanagari
  );
}

function getScriptScore(score, script) {
  if (script === 'japanese') return score.japanese + score.cjk;
  return score[script] || 0;
}

function getMultibyteScriptBonus(originalScore, decodedScore, script) {
  if (!isMultibyteScript(script)) return 0;
  return Math.max(0, originalScore.highLatin - decodedScore.length) * 10;
}

function getScriptPriorityBonus(score, script) {
  if (script === 'hangul' && score.hangul > 0) return 30;
  if (script === 'japanese' && score.japanese > 0) return 30 + score.japanese * 18;
  if (script === 'cjk' && score.commonCjk > 0) return score.commonCjk * 8;
  return 0;
}

function getScriptContextBonus(repairContext, script, score) {
  let bonus = 0;
  const hasTextContext = !!repairContext?.contextScripts?.size;
  if (!hasTextContext && repairContext?.languageScripts?.has(script)) bonus += 6;
  if (repairContext?.contextScripts?.has(script)) {
    bonus += script === 'japanese' && score.japanese === 0 ? 18 : 28;
  }
  if (!hasTextContext && script === 'cjk' && repairContext?.languageScripts?.has('japanese')) bonus -= 6;
  if (script === 'cjk' && repairContext?.contextScripts?.has('japanese')) {
    bonus -= hasDistinctiveScriptEvidence(score, 'cjk') ? 6 : 30;
  }
  if (!hasTextContext && script === 'japanese' && repairContext?.languageScripts?.has('cjk')) bonus -= 6;
  if (script === 'japanese' && repairContext?.contextScripts?.has('cjk')) {
    bonus -= hasDistinctiveScriptEvidence(score, 'japanese') ? 6 : 26;
  }
  return bonus;
}

function hasScriptContext(repairContext, script) {
  return repairContext?.languageScripts?.has(script) || repairContext?.contextScripts?.has(script);
}

function hasTextScriptContext(repairContext, script) {
  return repairContext?.contextScripts?.has(script);
}

function getEncodingPriorityBonus(encoding, repairContext) {
  if (encoding.label === 'shift_jis' && hasTextScriptContext(repairContext, 'japanese')) return 6;
  if ((encoding.label === 'gbk' || encoding.label === 'gb18030') && hasTextScriptContext(repairContext, 'cjk')) return 6;
  if (encoding.label === 'euc-kr' && hasTextScriptContext(repairContext, 'hangul')) return 6;
  return 0;
}

function getContextTextBonus(text, repairContext) {
  const candidate = normalizeContextMatchText(text);
  if (candidate.length < 2) {
    return hasSingleCharacterContextTokenMatch(candidate, repairContext) ? 140 : 0;
  }
  if (candidate.length >= 4 && hasContextTokenMatch(candidate, repairContext)) return 220;
  if (hasMultibyteContextSkeletonMatch(candidate, repairContext)) return 220;
  const compactCandidate = compactContextMatchText(candidate);
  let bonus = 0;
  for (const contextText of repairContext && repairContext.contextTexts || []) {
    const context = normalizeContextMatchText(contextText);
    if (!context || context === candidate) continue;
    if (context.includes(candidate)) {
      bonus = Math.max(bonus, candidate.length >= 4 ? 160 : 120);
      continue;
    }
    if (compactCandidate.length >= 4 && compactContextMatchText(context).includes(compactCandidate)) {
      bonus = Math.max(bonus, 100);
    }
  }
  return bonus;
}

function hasContextTokenMatch(candidate, repairContext) {
  if (!candidate) return false;
  for (const contextText of repairContext && repairContext.contextTexts || []) {
    if (getContextMatchTokens(contextText).has(candidate)) return true;
  }
  return false;
}

function hasMultibyteContextSkeletonMatch(candidate, repairContext) {
  const candidateSkeleton = getMultibyteContextSkeleton(candidate);
  if ([...candidateSkeleton].length < 2) return false;
  for (const contextText of repairContext && repairContext.contextTexts || []) {
    for (const token of getContextMatchTokens(contextText)) {
      if (getMultibyteContextSkeleton(token) === candidateSkeleton) return true;
    }
  }
  return false;
}

function hasSingleCharacterContextTokenMatch(candidate, repairContext) {
  if (!candidate || !isSingleCjkLikeText(candidate)) return false;
  return hasContextTokenMatch(candidate, repairContext);
}

function isSingleCjkLikeText(text) {
  if ([...text].length !== 1) return false;
  const code = text.codePointAt(0);
  return isJapanese(code) || isCjk(code) || isCjkCompatibility(code) || isHangul(code);
}

function getContextMatchTokens(contextText) {
  const context = normalizeContextMatchText(contextText);
  const tokens = new Set();
  for (const part of context.split(/[\\/]+/)) {
    addContextTokenVariants(tokens, part);
  }
  return tokens;
}

function addContextTokenVariants(tokens, value) {
  const text = String(value || '').trim();
  if (!text) return;
  addContextToken(tokens, text);

  const extensionIndex = text.lastIndexOf('.');
  if (extensionIndex > 0) addContextToken(tokens, text.slice(0, extensionIndex));

  for (const part of text.split(/[\s._\-()[\]{}]+/)) {
    addContextToken(tokens, part);
  }

  const withoutTrackPrefix = text.replace(/^\d+\s*[\-_. ]+\s*/, '');
  if (withoutTrackPrefix !== text) addContextTokenVariants(tokens, withoutTrackPrefix);
}

function addContextToken(tokens, value) {
  const token = String(value || '').trim();
  if (token) tokens.add(token);
}

function normalizeContextMatchText(text) {
  return String(text || '').normalize('NFKC').toLowerCase().trim();
}

function compactContextMatchText(text) {
  return text.replace(/[\s._\-()[\]{}]+/g, '');
}

function getMultibyteContextSkeleton(text) {
  let skeleton = '';
  for (const character of normalizeContextMatchText(text)) {
    const code = character.codePointAt(0);
    if (isJapanese(code) || isCjk(code) || isCjkCompatibility(code) || isHangul(code)) {
      skeleton += character;
    }
  }
  return skeleton;
}

function getScriptArtifactPenalty(score, script) {
  if (script !== 'cjk') return 0;
  return score.cjkMojibakeArtifacts * 18;
}

function isMultibyteScript(script) {
  return script === 'japanese' || script === 'cjk' || script === 'hangul';
}

function hasStrongMultibyteMojibakeSignal(score) {
  return score.windowsMarkers > 0 || score.utf8Markers > 0 || score.latinSymbols > 0 || score.controls > 0;
}

function isAsciiLatin(code) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isLatinLetter(code) {
  return isInRange(code, 0x00c0, 0x024f) || isInRange(code, 0x1e00, 0x1eff);
}

function isJapanese(code) {
  return isInRange(code, 0x3040, 0x30ff) || isInRange(code, 0xff66, 0xff9f);
}

function isCjk(code) {
  return isInRange(code, 0x3400, 0x4dbf) || isInRange(code, 0x4e00, 0x9fff);
}

function isCjkCompatibility(code) {
  return isInRange(code, 0xf900, 0xfaff);
}

function isCommonCjk(code) {
  return COMMON_CJK_CHARACTERS.has(String.fromCodePoint(code));
}

function isCjkMojibakeArtifact(code) {
  return code === 0x4e55 || code === 0x4e63 || code === 0x4e8a || isInRange(code, 0x50c0, 0x50ff);
}

function isHangul(code) {
  return isInRange(code, 0x1100, 0x11ff) || isInRange(code, 0x3130, 0x318f) || isInRange(code, 0xac00, 0xd7af);
}

function isPrivateUse(code) {
  return isInRange(code, 0xe000, 0xf8ff);
}

function isInRange(code, start, end) {
  return code >= start && code <= end;
}

function stringOrEmpty(value, languageHints = null) {
  if (typeof value === 'string') return repairAndTrimMetadataText(value, languageHints);
  if (value === null || value === undefined) return '';
  return repairAndTrimMetadataText(String(value), languageHints);
}

function repairAndTrimMetadataText(value, languageHints = null) {
  return repairLegacyMetadataMojibake(String(value), languageHints).trim();
}

function createMetadataRepairHints(languageHints, candidate = {}, metadata = {}) {
  return addRepairReferenceTexts(languageHints, [
    candidate.fileName,
    candidate.relativePath,
    candidate.path,
    metadata && metadata.common ? metadata.common.title : null
  ]);
}

function addRepairReferenceTexts(languageHints, referenceTexts) {
  const cleanReferences = referenceTexts
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  if (!cleanReferences.length) return languageHints;

  const base = typeof languageHints === 'string'
    ? { language: languageHints }
    : { ...(languageHints || {}) };
  const existingReferences = Array.isArray(base.referenceTexts) ? base.referenceTexts : [];
  return {
    ...base,
    referenceTexts: [...existingReferences, ...cleanReferences]
  };
}

function withRiffInfoTags(metadata, riffInfoTags, languageHints = null) {
  const nativeTags = normalizeRiffInfoTags(riffInfoTags, languageHints);
  if (!nativeTags.length) return metadata || {};
  const native = { ...((metadata && metadata.native) || {}) };
  const existing = Array.isArray(native[RIFF_INFO_NATIVE_TAG_TYPE]) ? native[RIFF_INFO_NATIVE_TAG_TYPE] : [];
  native[RIFF_INFO_NATIVE_TAG_TYPE] = [...nativeTags, ...existing];
  return {
    ...(metadata || {}),
    native
  };
}

function normalizeRiffInfoTags(riffInfoTags, languageHints = null) {
  if (!Array.isArray(riffInfoTags)) return [];
  const tags = [];
  for (const tag of riffInfoTags) {
    const id = normalizeNativeId(tag && tag.id);
    if (!id) continue;
    const value = decodeRiffInfoTagValue(tag, languageHints);
    if (!value) continue;
    tags.push({ id, value });
  }
  return tags;
}

function decodeRiffInfoTagValue(tag, languageHints = null) {
  if (typeof (tag && tag.value) === 'string') return repairAndTrimMetadataText(tag.value, languageHints);
  const bytes = tag && (tag.data || tag.bytes || tag.value);
  return decodeLegacyMetadataBytes(bytes, languageHints);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const number = integerOrNull(item);
      if (number !== null) return number;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return integerOrNull(value.no ?? value.value ?? value.total ?? value.of);
  }
  const text = normalizeNumericText(stringOrEmpty(value));
  const match = text.match(/\d+/);
  if (!match) return null;
  const number = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(number) ? number : null;
}

function parseNumberPair(value, languageHints = null) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseNumberPair(item, languageHints);
      if (parsed.value !== null || parsed.total !== null) return parsed;
    }
    return { value: null, total: null, hasExplicitTotal: false };
  }
  if (value && typeof value === 'object') {
    const valuePair = parseNumberPair(value.no ?? value.value ?? value.track ?? value.trackNo, languageHints);
    const total = integerOrNull(value.of ?? value.total ?? value.trackOf);
    return {
      value: valuePair.value,
      total: total ?? valuePair.total,
      hasExplicitTotal: total !== null || valuePair.hasExplicitTotal
    };
  }

  const text = normalizeNumericText(stringOrEmpty(value, languageHints))
    .replace(/[\u2044\u2215\uFF0F\\]/g, '/')
    .replace(/\bof\b/gi, '/')
    .trim();
  if (!text) return { value: null, total: null, hasExplicitTotal: false };

  const hasExplicitTotal = text.includes('/');
  const [valueText, totalText] = text.split('/', 2);
  return {
    value: integerOrNull(valueText),
    total: totalText === undefined ? null : integerOrNull(totalText),
    hasExplicitTotal
  };
}

function normalizeNumericText(value) {
  return String(value || '').replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\uFF10-\uFF19]/g, char => {
    const code = char.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code >= 0x0966 && code <= 0x096f) return String(code - 0x0966);
    return String(code - 0xff10);
  });
}

function getMetadataText(metadata, nativeIds, commonText, languageHints = null, { join = false, rejectNative = null } = {}) {
  const commonValue = stringOrEmpty(commonText, languageHints);
  const nativeText = getNativeText(metadata, nativeIds, languageHints, { join });
  if (nativeText.value &&
    (commonValue === '' || !LOW_PRIORITY_TEXT_NATIVE_TAG_TYPES.has(nativeText.tagType)) &&
    !(commonValue && rejectNative?.(nativeText.value))) {
    return nativeText.value;
  }
  return commonValue || nativeText.value || '';
}

function looksLikeId3GenreCode(value) {
  return /^\(?\d{1,3}\)?$/.test(String(value || '').trim());
}

function getNativeText(metadata, nativeIds, languageHints = null, { join = false } = {}) {
  const native = metadata && metadata.native ? metadata.native : {};
  for (const tagType of getNativeTagTypes(native)) {
    const values = [];
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(nativeIds, tag && tag.id)) continue;
      values.push(...textValues(tag.value, languageHints));
    }
    if (values.length > 0) {
      return {
        value: join ? joinTextValues(values) : values[0],
        tagType
      };
    }
  }
  return { value: '', tagType: '' };
}

function textValues(value, languageHints = null) {
  if (Array.isArray(value)) return value.flatMap(item => textValues(item, languageHints));
  if (value && typeof value === 'object') {
    return textValues(value.text ?? value.value ?? value.name ?? value.description, languageHints);
  }
  const text = stringOrEmpty(value, languageHints);
  return text ? [text] : [];
}

function joinTextValues(values) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].join('; ');
}

function getMetadataYear(metadata, commonYear, languageHints = null) {
  const commonValue = integerOrNull(commonYear);
  const nativeYear = getNativeYear(metadata, languageHints);
  if (nativeYear.value !== null &&
    (commonValue === null || (nativeYear.value >= 1000 && !LOW_PRIORITY_TEXT_NATIVE_TAG_TYPES.has(nativeYear.tagType)))) {
    return nativeYear.value;
  }
  return commonValue ?? nativeYear.value;
}

function getNativeYear(metadata, languageHints = null) {
  const native = metadata && metadata.native ? metadata.native : {};
  for (const tagType of getNativeTagTypes(native)) {
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(YEAR_NATIVE_IDS, tag && tag.id)) continue;
      const value = yearOrNull(tag.value, languageHints);
      if (value !== null) return { value, tagType };
    }
  }
  return { value: null, tagType: '' };
}

function yearOrNull(value, languageHints = null) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const year = yearOrNull(item, languageHints);
      if (year !== null) return year;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return yearOrNull(value.year ?? value.text ?? value.value ?? value.date, languageHints);
  }
  const text = normalizeNumericText(stringOrEmpty(value, languageHints));
  const match = text.match(/(?:^|\D)([12]\d{3})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : integerOrNull(value);
}

function getMetadataBoolean(metadata, nativeIds, commonValue) {
  const nativeValue = getNativeBoolean(metadata, nativeIds);
  if (nativeValue !== null) return nativeValue;
  return commonValue === true ? true : commonValue === false ? false : null;
}

function getNativeBoolean(metadata, nativeIds) {
  const native = metadata && metadata.native ? metadata.native : {};
  for (const tagType of getNativeTagTypes(native)) {
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(nativeIds, tag && tag.id)) continue;
      const value = booleanOrNull(tag.value);
      if (value !== null) return value;
    }
  }
  return null;
}

function booleanOrNull(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = booleanOrNull(item);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : null;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes') return true;
  if (text === '0' || text === 'false' || text === 'no') return false;
  return null;
}

function getMetadataNumberPair(metadata, commonKey, nativeIds, languageHints = null) {
  const common = normalizeCommonObject(metadata);
  const commonPair = parseNumberPair(common[commonKey], languageHints);
  const nativePair = getNativeNumberPair(metadata, nativeIds, languageHints);
  if (nativePair.value !== null) {
    return {
      value: nativePair.value,
      total: nativePair.total ?? commonPair.total,
      hasExplicitTotal: nativePair.hasExplicitTotal || commonPair.hasExplicitTotal
    };
  }
  if (commonPair.value !== null || commonPair.total !== null) {
    return {
      value: commonPair.value,
      total: commonPair.total ?? nativePair.total,
      hasExplicitTotal: commonPair.hasExplicitTotal || nativePair.hasExplicitTotal
    };
  }
  return nativePair;
}

function getNativeNumberPair(metadata, nativeIds, languageHints = null) {
  const native = metadata && metadata.native ? metadata.native : {};
  for (const tagType of getNativeTagTypes(native)) {
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(nativeIds, tag && tag.id)) continue;
      const parsed = parseNumberPair(tag.value, languageHints);
      if (parsed.value !== null || parsed.total !== null) return parsed;
    }
  }
  return { value: null, total: null, hasExplicitTotal: false };
}

function getNativeTagTypes(native) {
  const known = NATIVE_TAG_PRIORITY.filter(tagType => Array.isArray(native[tagType]));
  const rest = Object.keys(native).filter(tagType => !known.includes(tagType));
  return [...known, ...rest];
}

function hasNativeId(nativeIds, id) {
  return nativeIds.has(normalizeNativeId(id));
}

function normalizeNativeId(id) {
  return String(id || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function firstArrayString(value, languageHints = null) {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    const text = stringOrEmpty(item, languageHints);
    if (text) return text;
  }
  return '';
}

function joinedArtists(common, languageHints = null) {
  if (Array.isArray(common.artists)) {
    const artists = common.artists.map(artist => stringOrEmpty(artist, languageHints)).filter(Boolean);
    if (artists.length > 0) return artists.join('; ');
  }
  return stringOrEmpty(common.artist, languageHints);
}

function normalizeCommonObject(metadata) {
  return metadata && metadata.common ? metadata.common : {};
}

function normalizeFormatObject(metadata) {
  return metadata && metadata.format ? metadata.format : {};
}

function getSortText(common, names, languageHints = null) {
  for (const name of names) {
    const value = stringOrEmpty(common[name], languageHints);
    if (value) return value;
  }
  return '';
}

function selectPicture(pictures) {
  if (!Array.isArray(pictures) || pictures.length === 0) return null;

  for (const picture of pictures) {
    const descriptor = `${picture.type || ''} ${picture.description || ''}`.toLowerCase();
    if (descriptor.includes('front')) return picture;
  }

  return pictures[0];
}

function mimeFromArtworkExtension(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function formatByteLimit(byteLength) {
  const mebibyte = 1024 * 1024;
  if (byteLength >= mebibyte && byteLength % mebibyte === 0) {
    return `${byteLength / mebibyte} MiB`;
  }
  return `${byteLength} bytes`;
}

function getLibraryPlaybackUnsupportedReason(candidate) {
  const size = Number(candidate && candidate.size);
  if (!Number.isFinite(size) || size <= MAX_READ_FILE_BYTES) return null;
  return `Library playback reads are limited to ${formatByteLimit(MAX_READ_FILE_BYTES)} per file; this file is ${size} bytes.`;
}

function createFallbackTrack(candidate, now = Date.now()) {
  const title = path.basename(candidate.fileName, path.extname(candidate.fileName));
  const libraryPlaybackUnsupportedReason = getLibraryPlaybackUnsupportedReason(candidate);
  return {
    id: createTrackId(candidate.folderId, candidate.relativePath),
    folderId: candidate.folderId,
    relativePath: candidate.relativePath,
    fileName: candidate.fileName,
    ext: candidate.ext,
    size: candidate.size,
    mtimeMs: candidate.mtimeMs,
    title,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    year: null,
    trackNo: null,
    trackOf: null,
    discNo: null,
    discOf: null,
    compilation: false,
    sortTitle: '',
    sortAlbum: '',
    sortAlbumArtist: '',
    durationSec: null,
    sampleRate: null,
    bitrate: null,
    bitsPerSample: null,
    channels: null,
    codec: candidate.ext ? candidate.ext.toUpperCase() : '',
    artworkId: null,
    artworkBytes: null,
    artworkMime: null,
    artworkSourceKind: null,
    libraryPlaybackUnsupportedReason,
    addedAt: now,
    updatedAt: now
  };
}

function createTrackFromMetadata(candidate, metadata, now = Date.now(), { includeArtwork = true, maxArtworkBytes = MAX_ARTWORK_BYTES, languageHints = null, riffInfoTags = null } = {}) {
  const fallback = createFallbackTrack(candidate, now);
  const baseTextHints = createMetadataRepairHints(languageHints, candidate, metadata);
  const mappedMetadata = withRiffInfoTags(metadata, riffInfoTags, baseTextHints);
  const common = normalizeCommonObject(mappedMetadata);
  const format = normalizeFormatObject(mappedMetadata);
  const commonTitle = stringOrEmpty(common.title, baseTextHints);
  const title = getMetadataText(mappedMetadata, TITLE_NATIVE_IDS, commonTitle, baseTextHints) || fallback.title;
  const textHints = addRepairReferenceTexts(baseTextHints, [title]);
  const commonArtist = joinedArtists(common, textHints);
  const artist = getMetadataText(mappedMetadata, ARTIST_NATIVE_IDS, commonArtist, textHints, { join: true });
  const commonAlbumArtist = stringOrEmpty(common.albumartist, textHints);
  const albumArtist = getMetadataText(mappedMetadata, ALBUM_ARTIST_NATIVE_IDS, commonAlbumArtist, textHints, { join: true }) || artist || '';
  const commonGenre = firstArrayString(common.genre, textHints) || stringOrEmpty(common.genre, textHints);
  const genre = getMetadataText(mappedMetadata, GENRE_NATIVE_IDS, commonGenre, textHints, { rejectNative: looksLikeId3GenreCode });
  const lowerAlbumArtist = albumArtist.toLowerCase();
  const picture = includeArtwork ? selectPicture(common.picture) : null;
  const pictureBuffer = picture ? normalizeArtworkBuffer(picture.data, maxArtworkBytes) : null;
  const trackNumber = getMetadataNumberPair(mappedMetadata, 'track', TRACK_NATIVE_IDS, textHints);
  const discNumber = getMetadataNumberPair(mappedMetadata, 'disk', DISC_NATIVE_IDS, textHints);
  const compilation = getMetadataBoolean(mappedMetadata, COMPILATION_NATIVE_IDS, common.compilation) === true ||
    lowerAlbumArtist === 'various artists';

  return {
    ...fallback,
    title,
    artist,
    albumArtist,
    album: getMetadataText(mappedMetadata, ALBUM_NATIVE_IDS, stringOrEmpty(common.album, textHints), textHints),
    genre,
    year: getMetadataYear(mappedMetadata, common.year, textHints),
    trackNo: trackNumber.value,
    trackOf: trackNumber.total,
    discNo: discNumber.value,
    discOf: discNumber.total,
    compilation,
    sortTitle: getMetadataText(mappedMetadata, TITLE_SORT_NATIVE_IDS, getSortText(common, ['titlesort', 'titleSort', 'sorttitle'], textHints), textHints),
    sortAlbum: getMetadataText(mappedMetadata, ALBUM_SORT_NATIVE_IDS, getSortText(common, ['albumsort', 'albumSort', 'sortalbum'], textHints), textHints),
    sortAlbumArtist: getMetadataText(mappedMetadata, ALBUM_ARTIST_SORT_NATIVE_IDS, getSortText(common, ['albumartistsort', 'albumArtistSort', 'sortalbumartist'], textHints), textHints),
    durationSec: numberOrNull(format.duration),
    sampleRate: numberOrNull(format.sampleRate),
    bitrate: numberOrNull(format.bitrate),
    bitsPerSample: numberOrNull(format.bitsPerSample),
    channels: numberOrNull(format.numberOfChannels),
    codec: stringOrEmpty(format.codec, textHints) || stringOrEmpty(format.dataformat, textHints).toUpperCase() || fallback.codec,
    artworkBytes: pictureBuffer ? toArrayBuffer(pictureBuffer) : null,
    artworkMime: pictureBuffer ? stringOrEmpty(picture.format, textHints) || 'application/octet-stream' : null,
    artworkSourceKind: pictureBuffer ? 'embedded' : null
  };
}

function shouldRetryDuration(candidate, metadata) {
  const format = normalizeFormatObject(metadata);
  if (Number.isFinite(format.duration)) return false;
  return candidate.ext === 'aac' || candidate.ext === 'mp3';
}

function createParseTimeoutError(candidate, timeoutMs) {
  const error = new Error(`Metadata parsing timed out after ${timeoutMs} ms for ${candidate.relativePath || candidate.path}`);
  error.code = 'ERR_LIBRARY_PARSE_TIMEOUT';
  return error;
}

function parseFileWithWorkerGuards(candidate, options, signal, timeoutMs, maxArtworkBytes) {
  const pool = getMetadataParseWorkerPool();
  if (!pool) return null;
  return pool.run(candidate, options, signal, timeoutMs, maxArtworkBytes);
}

function parseFileDirectWithGuards(candidate, parseFile, options, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }

    let settled = false;
    let timeout = null;
    const parseAbortController = new AbortController();
    const canListenForAbort = signal && typeof signal.addEventListener === 'function';
    const parseOptions = addAbortSignalOption(options, parseAbortController.signal);

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (canListenForAbort) {
        signal.removeEventListener('abort', abort);
      }
    }

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    }

    function abort() {
      parseAbortController.abort();
      settle(reject, createAbortError());
    }

    if (canListenForAbort) {
      signal.addEventListener('abort', abort, { once: true });
    }

    timeout = setTimeout(() => {
      parseAbortController.abort();
      settle(reject, createParseTimeoutError(candidate, timeoutMs));
    }, timeoutMs);

    Promise.resolve()
      .then(() => parseFile(candidate.path, parseOptions))
      .then(
        metadata => settle(resolve, metadata),
        error => settle(reject, error)
      );
  });
}

function parseFileWithGuards(candidate, parseFile, options, signal, timeoutMs, maxArtworkBytes = MAX_ARTWORK_BYTES) {
  if (metadataParserMode === 'worker') {
    const workerPromise = parseFileWithWorkerGuards(candidate, options, signal, timeoutMs, normalizeMaxArtworkBytes(maxArtworkBytes));
    if (workerPromise) return workerPromise;
  }
  return parseFileDirectWithGuards(candidate, parseFile, options, signal, timeoutMs);
}

async function parseMetadataFile(candidate, parseFile, signal, parseFileTimeoutMs, { skipCovers = true, maxArtworkBytes = MAX_ARTWORK_BYTES } = {}) {
  if (!parseFile) return { metadata: null, error: null };

  try {
    throwIfAborted(signal);
    let metadata = await parseFileWithGuards(candidate, parseFile, {
      duration: false,
      skipCovers
    }, signal, parseFileTimeoutMs, maxArtworkBytes);
    throwIfAborted(signal);
    if (shouldRetryDuration(candidate, metadata)) {
      metadata = await parseFileWithGuards(candidate, parseFile, {
        duration: true,
        skipCovers
      }, signal, parseFileTimeoutMs, maxArtworkBytes);
      throwIfAborted(signal);
    }
    return { metadata, error: null };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { metadata: null, error };
  }
}

async function readRiffInfoTagsForCandidate(candidate, signal) {
  if (String(candidate && candidate.ext || '').toLowerCase() !== 'wav') return [];
  try {
    return await readRiffInfoTagsFromFile(candidate.path, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return [];
  }
}

async function readRiffInfoTagsFromFile(filePath, signal) {
  const fileHandle = await fs.promises.open(filePath, 'r');
  try {
    throwIfAborted(signal);
    const stat = await fileHandle.stat();
    throwIfAborted(signal);
    if (!stat.isFile() || stat.size < 12) return [];

    const header = await readFileHandleBytes(fileHandle, 0, 12, signal);
    if (!isRiffWaveHeader(header)) return [];

    const riffSize = header.readUInt32LE(4);
    const scanEnd = Math.min(stat.size, riffSize === 0xffffffff ? stat.size : riffSize + 8);
    const tags = [];
    let offset = 12;
    let chunkCount = 0;

    while (offset + 8 <= scanEnd && chunkCount < MAX_RIFF_SCAN_CHUNKS) {
      throwIfAborted(signal);
      const chunkHeader = await readFileHandleBytes(fileHandle, offset, 8, signal);
      const chunkId = chunkHeader.toString('ascii', 0, 4);
      const chunkSize = chunkHeader.readUInt32LE(4);
      const dataOffset = offset + 8;
      const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
      if (nextOffset <= offset || dataOffset + chunkSize > scanEnd) break;

      if (chunkId === 'LIST' && chunkSize >= 4 && chunkSize <= MAX_RIFF_INFO_LIST_BYTES) {
        const listData = await readFileHandleBytes(fileHandle, dataOffset, chunkSize, signal);
        tags.push(...parseRiffInfoListBuffer(listData));
      }

      offset = nextOffset;
      chunkCount += 1;
    }

    return tags;
  } finally {
    await fileHandle.close();
  }
}

async function readFileHandleBytes(fileHandle, position, length, signal) {
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    throwIfAborted(signal);
    const result = await fileHandle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

function parseRiffInfoListBuffer(listData) {
  if (listData.toString('ascii', 0, 4) !== 'INFO') return [];
  const tags = [];
  let offset = 4;

  while (offset + 8 <= listData.length) {
    const id = listData.toString('ascii', offset, offset + 4).trim().toUpperCase();
    const size = listData.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + size + (size % 2);
    if (nextOffset <= offset || dataOffset + size > listData.length) break;

    if (RIFF_INFO_TAG_IDS.has(id) && size <= MAX_RIFF_INFO_VALUE_BYTES) {
      tags.push({
        id,
        data: Buffer.from(listData.subarray(dataOffset, dataOffset + size))
      });
    }

    offset = nextOffset;
  }

  return tags;
}

function isRiffWaveHeader(header) {
  const riffId = header.toString('ascii', 0, 4);
  return (riffId === 'RIFF' || riffId === 'RF64') && header.toString('ascii', 8, 12) === 'WAVE';
}

async function resolveFolderArtworkDescriptor(directoryPath, cache, signal) {
  const directory = path.resolve(directoryPath);
  const key = `descriptor\0${directory}`;
  if (cache.has(key)) {
    return await cache.get(key);
  }

  const promise = (async () => {
    try {
      throwIfAborted(signal);
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      throwIfAborted(signal);
      const candidates = [];

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const parsed = path.parse(entry.name);
        const baseName = parsed.name.toLowerCase();
        const extension = parsed.ext.toLowerCase();
        const baseIndex = ARTWORK_BASENAMES.indexOf(baseName);
        const extensionIndex = ARTWORK_EXTENSIONS.indexOf(extension);
        if (baseIndex === -1 || extensionIndex === -1 || !ARTWORK_EXTENSION_SET.has(extension)) continue;
        candidates.push({
          path: path.join(directory, entry.name),
          baseIndex,
          extensionIndex,
          name: entry.name
        });
      }

      candidates.sort((a, b) => {
        if (a.baseIndex !== b.baseIndex) return a.baseIndex - b.baseIndex;
        if (a.extensionIndex !== b.extensionIndex) return a.extensionIndex - b.extensionIndex;
        return a.name.localeCompare(b.name);
      });

      if (candidates.length === 0) return null;

      for (const candidate of candidates) {
        throwIfAborted(signal);
        const stat = await fs.promises.stat(candidate.path);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTWORK_BYTES) continue;
        return {
          path: candidate.path,
          mime: mimeFromArtworkExtension(candidate.path),
          sourceKind: 'folder-image'
        };
      }

      return null;
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  })();

  cache.set(key, promise);
  return await promise;
}

async function findFolderArtwork(directoryPath, cache, signal) {
  const descriptor = await resolveFolderArtworkDescriptor(directoryPath, cache, signal);
  if (!descriptor) return null;

  const key = `bytes\0${path.resolve(descriptor.path)}`;
  const cachedPromise = getCachedFolderArtworkPromise(cache, key);
  if (cachedPromise) {
    return await cachedPromise;
  }

  const promise = (async () => {
    try {
      throwIfAborted(signal);
      const buffer = await readFileBufferWithinLimit(descriptor.path, MAX_ARTWORK_BYTES, signal);
      throwIfAborted(signal);
      if (!buffer || buffer.length <= 0 || buffer.length > MAX_ARTWORK_BYTES) return null;
      return {
        ...descriptor,
        id: createArtworkIdFromBytes(buffer),
        buffer
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  })();

  cacheFolderArtworkPromise(cache, key, promise);
  return await promise;
}

async function readFileBufferWithinLimit(filePath, maxBytes, signal) {
  const fileHandle = await fs.promises.open(filePath, 'r');
  try {
    throwIfAborted(signal);
    const stat = await fileHandle.stat();
    throwIfAborted(signal);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;

    const buffer = Buffer.allocUnsafe(stat.size);
    let bytesRead = 0;
    while (bytesRead < stat.size) {
      const result = await fileHandle.read(buffer, bytesRead, stat.size - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
      throwIfAborted(signal);
    }

    const finalStat = await fileHandle.stat();
    throwIfAborted(signal);
    if (!finalStat.isFile() || finalStat.size <= 0 || finalStat.size > maxBytes) return null;
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function attachFolderArtwork(track, candidate, artworkCache, signal) {
  if (track.artworkBytes) return track;
  const artwork = await findFolderArtwork(path.dirname(candidate.path), artworkCache, signal);
  if (!artwork) return track;

  return {
    ...track,
    artworkId: artwork.id,
    artworkBytes: artwork.buffer,
    artworkMime: artwork.mime,
    artworkSourceKind: artwork.sourceKind
  };
}

async function parseLibraryFile(candidate, parseFile, artworkCache, signal, parseFileTimeoutMs, now = Date.now(), { skipCovers = true, maxArtworkBytes = MAX_ARTWORK_BYTES, languageHints = null } = {}) {
  const parsed = await parseMetadataFile(candidate, parseFile, signal, parseFileTimeoutMs, { skipCovers, maxArtworkBytes });
  const riffInfoTags = await readRiffInfoTagsForCandidate(candidate, signal);
  const hasRiffInfoTags = riffInfoTags.length > 0;
  const track = parsed.metadata || hasRiffInfoTags
    ? createTrackFromMetadata(candidate, parsed.metadata || {}, now, { includeArtwork: !skipCovers, maxArtworkBytes, languageHints, riffInfoTags })
    : createFallbackTrack(candidate, now);

  return {
    track: await attachFolderArtwork(track, candidate, artworkCache, signal),
    error: parsed.error
  };
}

function createEmptyBatchPayloadState() {
  return {
    tracks: [],
    artworkById: new Map(),
    artworkBytes: 0
  };
}

function finalizeBatchPayloadState(state) {
  return {
    tracks: state.tracks,
    artworks: [...state.artworkById.values()]
  };
}

function normalizeByteOption(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error('Byte offset, length, and maxBytes must be non-negative safe integers');
  }
  return number;
}

function normalizeMaxBytesOption(value) {
  const maxBytes = normalizeByteOption(value, MAX_READ_FILE_BYTES);
  return maxBytes > MAX_READ_FILE_BYTES ? MAX_READ_FILE_BYTES : maxBytes;
}

function assertReadWithinLimit(byteLength, maxBytes) {
  if (byteLength > maxBytes) {
    const error = new Error(`Requested byte range (${byteLength} bytes) exceeds maximum read size of ${formatByteLimit(maxBytes)} (${maxBytes} bytes) for library playback`);
    error.code = 'ERR_LIBRARY_READ_LIMIT';
    error.requestedBytes = byteLength;
    error.maxBytes = maxBytes;
    throw error;
  }
}

function assertReadableFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('File path is required');
  }
  return path.resolve(filePath);
}

function createNotFileError(filePath) {
  const error = new Error(`${filePath} is not a file`);
  error.code = 'EISDIR';
  return error;
}

function isMissingOrNonFileError(error) {
  return Boolean(error && (
    error.code === 'ENOENT' ||
    error.code === 'ENOTDIR' ||
    error.code === 'EISDIR'
  ));
}

async function assertReadableFileTarget(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw createNotFileError(filePath);
  }
}

async function readFileBytes(filePath, options = {}) {
  const resolvedPath = assertReadableFilePath(filePath);
  const offset = normalizeByteOption(options.offset, 0);
  const maxBytes = normalizeMaxBytesOption(options.maxBytes);

  const fileHandle = await fs.promises.open(resolvedPath, 'r');
  try {
    const stat = await fileHandle.stat();
    if (!stat.isFile()) {
      const error = new Error(`${resolvedPath} is not a file`);
      error.code = 'EISDIR';
      throw error;
    }
    if (offset >= stat.size) return new ArrayBuffer(0);

    const availableBytes = stat.size - offset;
    const requestedLength = options.length === undefined || options.length === null
      ? availableBytes
      : normalizeByteOption(options.length, 0);
    const length = requestedLength < availableBytes ? requestedLength : availableBytes;
    if (length === 0) return new ArrayBuffer(0);
    assertReadWithinLimit(length, maxBytes);

    const buffer = Buffer.allocUnsafe(length);
    const result = await fileHandle.read(buffer, 0, length, offset);
    return toArrayBuffer(buffer.subarray(0, result.bytesRead));
  } finally {
    await fileHandle.close();
  }
}

async function readArtworkBytes(filePath, options = {}) {
  const resolvedPath = assertReadableFilePath(filePath);
  if (!isSupportedAudioFile(resolvedPath)) {
    throw new Error('Library artwork reads require a supported audio file');
  }
  await assertReadableFileTarget(resolvedPath);
  const signal = options.signal;
  const parseFileTimeoutMs = normalizeParseFileTimeoutMs(options.parseFileTimeoutMs);
  const maxArtworkBytes = normalizeMaxArtworkBytes(options.maxArtworkBytes);
  const metadataModule = await loadMusicMetadata();
  const parseFile = getParseFile(metadataModule);

  if (parseFile) {
    try {
      throwIfAborted(signal);
      const metadata = await parseFileWithGuards({
        path: resolvedPath,
        relativePath: path.basename(resolvedPath)
      }, parseFile, {
        duration: false,
        skipCovers: false
      }, signal, parseFileTimeoutMs, maxArtworkBytes);
      throwIfAborted(signal);
      const picture = selectPicture(normalizeCommonObject(metadata).picture);
      const pictureBuffer = picture ? normalizeArtworkBuffer(picture.data, maxArtworkBytes) : null;
      if (pictureBuffer) return toArrayBuffer(pictureBuffer);
    } catch (error) {
      if (isAbortError(error) || isMissingOrNonFileError(error)) throw error;
    }
  }

  await assertReadableFileTarget(resolvedPath);
  const artworkCache = prepareFolderArtworkCache(options.artworkCache, options.maxFolderArtworkCacheBytes);
  const artwork = await findFolderArtwork(path.dirname(resolvedPath), artworkCache, signal);
  return artwork ? toArrayBuffer(artwork.buffer) : null;
}

async function scanLibrary(options = {}, sink = () => {}) {
  const signal = options.signal;
  const requestedRoots = normalizeRoots(options.roots);
  const knownFileMap = createKnownFileMap(options.knownFiles);
  const concurrency = normalizeConcurrency(options.concurrency);
  const batchSize = normalizeBatchSize(options.batchSize);
  const seenFilesBatchSize = normalizeSeenFilesBatchSize(options.seenFilesBatchSize);
  const batchIntervalMs = normalizeBatchIntervalMs(options.batchIntervalMs);
  const maxBatchArtworkBytes = normalizeMaxBatchArtworkBytes(options.maxBatchArtworkBytes);
  const maxFolderArtworkCacheBytes = normalizeMaxFolderArtworkCacheBytes(options.maxFolderArtworkCacheBytes);
  const parseFileTimeoutMs = normalizeParseFileTimeoutMs(options.parseFileTimeoutMs);
  const maxArtworkBytes = normalizeMaxArtworkBytes(options.maxArtworkBytes);
  const skipCovers = options.skipCovers !== false;
  const languageHints = options.languageHints || null;
  const metadataModule = await loadMusicMetadata();
  const parseFile = getParseFile(metadataModule);
  const artworkCache = createFolderArtworkCache(maxFolderArtworkCacheBytes);
  const roots = [];
  const rootErrors = [];
  let seenFilesBatch = [];
  const parseQueue = [];
  const stats = {
    found: 0,
    parsed: 0,
    parseErrors: 0,
    skipped: 0
  };
  let skippedSinceLastEmit = 0;
  let lastEnumeratedEntry = null;
  let lastEnumerateProgressFound = 0;
  let lastBatchAt = Date.now();
  let batchState = createEmptyBatchPayloadState();

  async function emitEnumerateProgress(entry, force = false) {
    if (!entry || stats.found === lastEnumerateProgressFound) return;
    if (!force && stats.found !== 1 && stats.found % batchSize !== 0) return;
    lastEnumerateProgressFound = stats.found;
    await emitToSink(sink, {
      type: 'enumerate-progress',
      found: stats.found,
      folderId: entry.folderId,
      currentPath: entry.relativePath
    });
  }

  async function flushBatch(force = false) {
    if (batchState.tracks.length === 0) return;
    const now = Date.now();
    if (!force && batchState.tracks.length < batchSize && now - lastBatchAt < batchIntervalMs) return;

    const payload = finalizeBatchPayloadState(batchState);
    batchState = createEmptyBatchPayloadState();
    lastBatchAt = now;
    await emitToSink(sink, { type: 'batch', ...payload });
  }

  async function appendTrackToBatch(track) {
    const artworkBuffer = normalizeArtworkBuffer(track.artworkBytes, maxArtworkBytes);
    if (!artworkBuffer) {
      batchState.tracks.push({
        ...track,
        artworkBytes: null,
        artworkMime: null,
        artworkSourceKind: null
      });
      return;
    }

    const artworkId = track.artworkId || createArtworkIdFromBytes(artworkBuffer);
    const hasArtworkInCurrentPayload = batchState.artworkById.has(artworkId);
    const artworkByteLength = artworkBuffer.byteLength;
    if (!hasArtworkInCurrentPayload &&
      batchState.tracks.length > 0 &&
      batchState.artworkBytes > 0 &&
      batchState.artworkBytes + artworkByteLength > maxBatchArtworkBytes) {
      await flushBatch(true);
    }

    let artwork = batchState.artworkById.get(artworkId);
    if (artwork) {
      artwork.refCount += 1;
    } else {
      artwork = {
        id: artworkId,
        bytes: toArrayBuffer(artworkBuffer),
        mime: track.artworkMime || 'application/octet-stream',
        sourceKind: track.artworkSourceKind || 'embedded',
        refCount: 1
      };
      batchState.artworkById.set(artworkId, artwork);
      batchState.artworkBytes += artworkByteLength;
    }

    batchState.tracks.push({
      ...track,
      artworkId,
      artworkBytes: null
    });
  }

  async function emitSeenFile(file) {
    seenFilesBatch.push(file);
    if (seenFilesBatch.length >= seenFilesBatchSize) {
      const files = seenFilesBatch;
      seenFilesBatch = [];
      await emitToSink(sink, { type: 'seen-files', files });
    }
  }

  async function flushSeenFiles() {
    if (seenFilesBatch.length === 0) return;
    const files = seenFilesBatch;
    seenFilesBatch = [];
    await emitToSink(sink, { type: 'seen-files', files });
  }

  async function drainParseQueue() {
    if (parseQueue.length === 0) return;
    const queue = parseQueue.splice(0, parseQueue.length);
    let nextIndex = 0;

    async function parseWorker() {
      while (true) {
        throwIfAborted(signal);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= queue.length) return;

        const candidate = queue[index];
        let result;

        try {
          result = await parseLibraryFile(candidate, parseFile, artworkCache, signal, parseFileTimeoutMs, Date.now(), {
            skipCovers,
            maxArtworkBytes,
            languageHints
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          result = { track: createFallbackTrack(candidate), error };
        }

        if (result.error) {
          stats.parseErrors += 1;
          await emitToSink(sink, {
            type: 'parse-error',
            folderId: candidate.folderId,
            relativePath: candidate.relativePath,
            reason: result.error.message || String(result.error)
          });
        }

        if (result.track) {
          stats.parsed += 1;
          await appendTrackToBatch(result.track);
          await flushBatch(false);
        }
      }
    }

    const workerCount = queue.length < concurrency ? queue.length : concurrency;
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(parseWorker());
    }
    await Promise.all(workers);
  }

  throwIfAborted(signal);

  for (const root of requestedRoots) {
    try {
      await assertReadableDirectory(root, signal);
      roots.push(root);
    } catch (error) {
      rootErrors.push({ root, error });
    }
  }

  if (roots.length === 0 && rootErrors.length > 0) {
    const { root, error } = rootErrors[0];
    const payload = toErrorPayload(error);
    await emitToSink(sink, {
      type: 'error',
      fatal: true,
      folderId: root.folderId,
      path: root.path,
      ...payload
    });
    throw error;
  }

  for (const { root, error } of rootErrors) {
    const payload = toErrorPayload(error);
    await emitToSink(sink, {
      type: 'error',
      fatal: false,
      folderId: root.folderId,
      path: root.path,
      ...payload
    });
  }

  for (const root of roots) {
    for await (const entry of enumerateAudioFiles(root, signal)) {
      throwIfAborted(signal);

      if (entry.type !== 'file') {
        const payload = toErrorPayload(entry.error);
        await emitToSink(sink, {
          type: 'error',
          fatal: false,
          folderId: entry.folderId,
          path: entry.path,
          relativePath: entry.relativePath,
          ...payload
        });
        continue;
      }

      stats.found += 1;
      lastEnumeratedEntry = entry;
      await emitSeenFile({ folderId: entry.folderId, relativePath: entry.relativePath });
      await emitEnumerateProgress(entry);
      throwIfAborted(signal);

      const knownFile = knownFileMap.get(getKnownFileKey(entry.folderId, entry.relativePath));
      if (hasSameFileStat(knownFile, entry)) {
        stats.skipped += 1;
        skippedSinceLastEmit += 1;
        if (skippedSinceLastEmit >= batchSize) {
          await emitToSink(sink, { type: 'skipped', count: skippedSinceLastEmit });
          skippedSinceLastEmit = 0;
        }
      } else {
        parseQueue.push(entry);
        if (parseQueue.length >= MAX_PARSE_QUEUE_SIZE) {
          await drainParseQueue();
        }
      }
    }
  }

  throwIfAborted(signal);
  await emitEnumerateProgress(lastEnumeratedEntry, true);
  throwIfAborted(signal);

  if (skippedSinceLastEmit > 0) {
    await emitToSink(sink, { type: 'skipped', count: skippedSinceLastEmit });
  }

  await drainParseQueue();
  throwIfAborted(signal);
  await flushSeenFiles();
  throwIfAborted(signal);
  await flushBatch(true);
  throwIfAborted(signal);

  const doneEvent = {
    type: 'done',
    found: stats.found,
    parsed: stats.parsed,
    parseErrors: stats.parseErrors,
    skipped: stats.skipped
  };
  await emitToSink(sink, doneEvent);
  return { ...stats };
}

function createLibraryScan(options = {}, sink = () => {}) {
  const controller = new AbortController();
  const scanId = options.scanId || `scan_${Date.now().toString(36)}`;
  const promise = scanLibrary({ ...options, scanId, signal: controller.signal }, sink);

  return {
    scanId,
    promise,
    cancel() {
      controller.abort();
    }
  };
}

module.exports = {
  ARTWORK_BASENAMES,
  DEFAULT_BATCH_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_BATCH_ARTWORK_BYTES,
  DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES,
  DEFAULT_SEEN_FILES_BATCH_SIZE,
  DEFAULT_PARSE_FILE_TIMEOUT_MS,
  MAX_ARTWORK_BYTES,
  MAX_BATCH_ARTWORK_BYTES,
  MAX_BATCH_SIZE,
  MAX_FOLDER_ARTWORK_CACHE_BYTES,
  MAX_READ_FILE_BYTES,
  MAX_SEEN_FILES_BATCH_SIZE,
  SUPPORTED_AUDIO_EXTENSIONS,
  createAbortError,
  createLibraryScan,
  createTrackId,
  isAbortError,
  isSupportedAudioFile,
  normalizeRelativePath,
  readArtworkBytes,
  readFileBytes,
  scanLibrary
};

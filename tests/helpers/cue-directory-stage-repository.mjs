export function createCueDirectoryStageHandler(state = {}) {
  const directories = new Map();
  state.cueStageMaxPageRows = 0;
  state.cueStageClearCount = 0;

  return async request => {
    const key = request.directoryPath ?? '';
    if (request.action === 'reset') {
      directories.set(key, createDirectory());
      return { cleared: true };
    }
    const directory = directories.get(key) ?? createDirectory();
    directories.set(key, directory);

    switch (request.action) {
      case 'clear':
        directories.delete(key);
        state.cueStageClearCount += 1;
        return { cleared: true };
      case 'append-entries':
        state.cueStageMaxPageRows = Math.max(state.cueStageMaxPageRows, request.entries.length);
        directory.files.push(...request.entries.map(entry => ({ ...entry })));
        directory.files.sort((left, right) => left.sequence - right.sequence);
        return { staged: request.entries.length };
      case 'list-files':
        return sequencePage(
          directory.files.filter(file => request.kind == null || file.kind === request.kind),
          request.cursor,
          request.limit
        );
      case 'get-file':
        return { file: requireFile(directory, request.relativePath) };
      case 'update-observations':
        for (const observation of request.observations) {
          Object.assign(requireFile(directory, observation.relativePath), observation);
        }
        return { updated: request.observations.length };
      case 'resolve-references':
        return resolveReferences(directory, request.references);
      case 'stage-sheet':
        directory.sheets.set(request.cue.cueRelativePath, {
          cueRelativePath: request.cue.cueRelativePath,
          cueOrderKey: request.cueOrderKey,
          cueSignature: request.cueSignature,
          cue: request.cue,
          status: 'parsed',
          accepted: false
        });
        return { staged: true };
      case 'list-sources':
        return listSources(directory, request.cursor, request.limit);
      case 'update-source': {
        const file = requireFile(directory, request.relativePath);
        file.metadataStatus = request.metadataStatus;
        file.metadata = request.metadata ?? null;
        return { updated: true };
      }
      case 'list-sheets':
        return listSheets(directory, request);
      case 'get-source-metadata':
        return {
          items: request.relativePaths.map(relativePath => {
            const file = requireFile(directory, relativePath);
            return { relativePath, metadataStatus: file.metadataStatus, metadata: file.metadata ?? null };
          })
        };
      case 'validate-sheet': {
        const sheet = directory.sheets.get(request.cueRelativePath);
        sheet.status = request.valid ? 'valid' : 'invalid';
        sheet.accepted = false;
        if (request.valid) {
          const durations = new Map(request.durations.map(item => [item.trackNo, item.durationSec]));
          sheet.cue = {
            ...sheet.cue,
            tracks: sheet.cue.tracks.map(track => ({ ...track, durationSec: durations.get(track.trackNo) }))
          };
        }
        return { updated: true };
      }
      case 'accept-sheet':
        return acceptSheet(directory, request.cueRelativePath);
      case 'list-logical':
        return listLogical(directory, request);
      default:
        throw new Error(`Unsupported CUE stage action: ${request.action}`);
    }
  };
}

function createDirectory() {
  return { files: [], sheets: new Map(), owners: new Map() };
}

function sequencePage(rows, cursor, limit) {
  const after = cursor == null ? -1 : cursor;
  const matching = rows.filter(row => row.sequence > after);
  const items = matching.slice(0, limit);
  return {
    items,
    nextCursor: matching.length > limit ? items.at(-1).sequence : null
  };
}

function resolveReferences(directory, references) {
  const audio = directory.files.filter(file => file.kind === 'audio');
  const paths = new Set();
  for (const reference of references) {
    const name = reference.normalize('NFC');
    const exact = audio.filter(file => fileName(file.relativePath).normalize('NFC') === name);
    const matches = exact.length
      ? exact
      : audio.filter(file => fileName(file.relativePath).normalize('NFC').toLowerCase() === name.toLowerCase());
    for (const match of matches) paths.add(match.relativePath);
  }
  return { availableRelativePaths: [...paths] };
}

function listSources(directory, cursor, limit) {
  const referenced = new Set(
    [...directory.sheets.values()]
      .filter(sheet => sheet.status === 'parsed')
      .flatMap(sheet => sheet.cue.resolvedFiles)
  );
  return sequencePage(
    directory.files.filter(file => referenced.has(file.relativePath)),
    cursor,
    limit
  );
}

function listSheets(directory, request) {
  const cursor = request.cursor ?? { cueOrderKey: '', cueRelativePath: '' };
  const rows = [...directory.sheets.values()]
    .filter(sheet => sheet.status === request.status)
    .sort((left, right) => compareCodeUnits(left.cueOrderKey, right.cueOrderKey) ||
      compareCodeUnits(left.cueRelativePath, right.cueRelativePath))
    .filter(sheet => sheet.cueOrderKey > cursor.cueOrderKey ||
      (sheet.cueOrderKey === cursor.cueOrderKey && sheet.cueRelativePath > cursor.cueRelativePath));
  const items = rows.slice(0, request.limit);
  return {
    items: items.map(sheet => ({
      cueRelativePath: sheet.cueRelativePath,
      cueOrderKey: sheet.cueOrderKey,
      cueSignature: sheet.cueSignature
    })),
    nextCursor: items.length === request.limit
      ? { cueOrderKey: items.at(-1).cueOrderKey, cueRelativePath: items.at(-1).cueRelativePath }
      : null
  };
}

function acceptSheet(directory, cueRelativePath) {
  const sheet = directory.sheets.get(cueRelativePath);
  if (sheet.cue.resolvedFiles.some(relativePath => directory.owners.has(relativePath))) {
    sheet.status = 'invalid';
    return { accepted: false };
  }
  sheet.accepted = true;
  for (const relativePath of sheet.cue.resolvedFiles) directory.owners.set(relativePath, cueRelativePath);
  return { accepted: true };
}

function listLogical(directory, request) {
  const cueRelativePath = directory.owners.get(request.relativePath);
  if (!cueRelativePath) return { sheet: null, items: [], nextCursor: null };
  const sheet = directory.sheets.get(cueRelativePath);
  const file = requireFile(directory, request.relativePath);
  const cursor = request.cursor ?? 0;
  const tracks = sheet.cue.tracks
    .filter(track => track.relativePath === request.relativePath && track.trackNo > cursor)
    .slice(0, request.limit);
  return {
    sheet: {
      cueRelativePath,
      cueSignature: sheet.cueSignature,
      disc: sheet.cue.disc,
      trackTotal: sheet.cue.tracks.length,
      metadata: file.metadata ?? {}
    },
    items: tracks,
    nextCursor: tracks.length === request.limit ? tracks.at(-1).trackNo : null
  };
}

function requireFile(directory, relativePath) {
  const file = directory.files.find(item => item.relativePath === relativePath);
  if (!file) throw new Error(`Missing staged file: ${relativePath}`);
  return file;
}

function fileName(relativePath) {
  return relativePath.split('/').at(-1) ?? relativePath;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

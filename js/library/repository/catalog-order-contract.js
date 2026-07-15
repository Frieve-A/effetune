export const MUSIC_LIBRARY_ORDER_VERSION = 'v2-nfkc-utf8-hex-null-last-1';
export const MISSING_TRACK_NUMBER_SORT = Number.MAX_SAFE_INTEGER;

const text = field => Object.freeze({ field, type: 'bytes', nulls: 'last' });
const number = field => Object.freeze({ field, type: 'number', nulls: 'last' });

export const TRACK_ORDER_SPECS = Object.freeze({
  title: Object.freeze([text('sortTitle')]),
  artist: Object.freeze([
    text('sortAlbumArtist'), text('sortAlbum'), number('discSort'),
    number('trackSort'), text('sortTitle')
  ]),
  album: Object.freeze([
    text('sortAlbum'), number('discSort'), number('trackSort'), text('sortTitle')
  ]),
  genre: Object.freeze([
    text('sortGenre'), text('sortAlbumArtist'), text('sortAlbum'), text('sortTitle')
  ]),
  added: Object.freeze([number('addedAt')]),
  duration: Object.freeze([number('durationSort'), text('sortTitle')])
});

export const ENTITY_NAME_ORDER_SPECS = Object.freeze({
  album: Object.freeze([text('sortName'), text('sortArtist')]),
  artist: Object.freeze([text('sortName')]),
  genre: Object.freeze([text('sortName')]),
  folder: Object.freeze([text('sortName')]),
  subfolder: Object.freeze([text('sortName')]),
  playlist: Object.freeze([text('sortName')])
});

export function encodeCanonicalSortKey(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/\\/g, '/');
  return [...new TextEncoder().encode(normalized)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

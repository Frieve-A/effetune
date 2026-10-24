'use strict';

const VIEWS = Object.freeze([
  ['tracks', 'Tracks'], ['albums', 'Albums'], ['artists', 'Artists'], ['genres', 'Genres'],
  ['subfolders', 'Subfolders'], ['files', 'Files'], ['folders', 'Folders'],
  ['recent', 'Recently Added'], ['playlists', 'Playlists']
].map(([id, title]) => Object.freeze({ id, title })));
const CLASSES = Object.freeze({
  track: 'object.item.audioItem.musicTrack', album: 'object.container.album.musicAlbum',
  artist: 'object.container.person.musicArtist', genre: 'object.container.genre.musicGenre',
  subfolder: 'object.container.storageFolder', folder: 'object.container.storageFolder',
  directory: 'object.container.storageFolder', playlist: 'object.container.playlistContainer',
  view: 'object.container'
});
const SEARCH_CAPS = Object.freeze(['dc:title', 'upnp:artist', 'upnp:album', 'upnp:genre', 'upnp:class']);
const SORT_CAPS = Object.freeze(['dc:title', 'upnp:artist', 'upnp:album', 'upnp:genre', 'upnp:originalTrackNumber', 'dc:date', 'res@duration', 'et:addedAt', 'et:displayPath']);

function parseSort(criteria = '') {
  if (!criteria) return [];
  if (typeof criteria !== 'string' || criteria.length > 512) throw new Error('709');
  return criteria.split(',').map(term => {
    const match = /^([+-])(.+)$/.exec(term.trim());
    if (!match || !SORT_CAPS.includes(match[2])) throw new Error('709');
    return { property: match[2], direction: match[1] === '+' ? 'asc' : 'desc' };
  });
}

// Parse the ContentDirectory grammar into data; SQL compilation only accepts known properties.
function parseSearch(criteria) {
  if (criteria === '*') return { all: true };
  if (typeof criteria !== 'string' || criteria.length > 4096) throw new Error('708');
  const tokens = [];
  const expression = /\s*(\(|\)|!=|<=|>=|=|<|>|"(?:\\["\\]|[^"\\])*"|[\w:@.-]+)/gy;
  let offset = 0;
  while (offset < criteria.length) {
    expression.lastIndex = offset;
    const match = expression.exec(criteria);
    if (!match) { if (!criteria.slice(offset).trim()) break; throw new Error('708'); }
    tokens.push(match[1]); offset = expression.lastIndex;
    if (tokens.length > 192) throw new Error('708');
  }
  let index = 0;
  const relation = depth => {
    if (depth > 12) throw new Error('708');
    if (tokens[index] === '(') {
      index++;
      const node = disjunction(depth + 1);
      if (tokens[index++] !== ')') throw new Error('708');
      return node;
    }
    const property = tokens[index++]; const operator = tokens[index++]; const token = tokens[index++];
    if (!SEARCH_CAPS.includes(property)) throw new Error('708');
    if (operator === 'exists' && ['true', 'false'].includes(token)) return { property, operator, value: token === 'true' };
    if (!['=', '!=', '<', '<=', '>', '>=', 'contains', 'doesNotContain', 'derivedfrom'].includes(operator) || !token?.startsWith('"')) throw new Error('708');
    if (operator === 'derivedfrom' && property !== 'upnp:class') throw new Error('708');
    return { property, operator, value: token.slice(1, -1).replace(/\\(["\\])/g, '$1') };
  };
  const conjunction = depth => { let node = relation(depth); while (tokens[index] === 'and') { index++; node = { and: [node, relation(depth)] }; } return node; };
  const disjunction = depth => { let node = conjunction(depth); while (tokens[index] === 'or') { index++; node = { or: [node, conjunction(depth)] }; } return node; };
  const result = disjunction(0);
  if (index !== tokens.length) throw new Error('708');
  return result;
}

module.exports = { VIEWS, CLASSES, SEARCH_CAPS, SORT_CAPS, parseSearch, parseSort };

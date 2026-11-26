const CONTENT = 'urn:schemas-upnp-org:service:ContentDirectory:1';
const CONNECTION = 'urn:schemas-upnp-org:service:ConnectionManager:1';
const PLAYLIST = 'urn:av-openhome-org:service:Playlist:1';
const REMOTE_CONTROL = 'urn:effetune-org:service:RemoteControl:1';
const METADATA = 'urn:effetune-org:metadata-1-0';
const MULTICAST = '239.255.255.250';
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
  if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] ?? whole;
  const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});

// A bounded, non-validating XML reader: no DTDs, external entities, or expansion.
function parseXml(source) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Invalid device response');
  const root = { name: '', children: [], text: '', attrs: Object.create(null) };
  const stack = [root];
  const namePattern = /[\w:.-]+/y;
  const whitespacePattern = /\s*/y;
  let position = 0;
  const readName = () => {
    namePattern.lastIndex = position;
    const match = namePattern.exec(source);
    if (!match) throw new Error('Invalid device response');
    position = namePattern.lastIndex;
    return match[0];
  };
  const skipWhitespace = () => {
    whitespacePattern.lastIndex = position;
    whitespacePattern.exec(source);
    position = whitespacePattern.lastIndex;
  };
  while (position < source.length) {
    if (source[position] !== '<') {
      const end = source.indexOf('<', position);
      const next = end < 0 ? source.length : end;
      stack.at(-1).text += decode(source.slice(position, next));
      position = next;
      continue;
    }
    const section = source.startsWith('<!--', position) ? ['-->', 4] :
      source.startsWith('<![CDATA[', position) ? [']]>', 9] :
        source.startsWith('<?', position) ? ['?>', 2] : null;
    if (section) {
      const end = source.indexOf(section[0], position + section[1]);
      if (end < 0) throw new Error('Invalid device response');
      if (section[1] === 9) stack.at(-1).text += source.slice(position + section[1], end);
      position = end + section[0].length;
      continue;
    }
    if (source.startsWith('</', position)) {
      position += 2;
      const name = readName();
      skipWhitespace();
      if (source[position] !== '>' || stack.length === 1 || stack.at(-1).qualified !== name) throw new Error('Invalid device response');
      position += 1;
      stack.pop();
    } else {
      position += 1;
      const name = readName();
      if (stack.length > 64) throw new Error('Invalid device response');
      const node = { name: name.split(':').at(-1), qualified: name, children: [], text: '', attrs: Object.create(null), namespaces: { ...stack.at(-1).namespaces } };
      let selfClosing = false;
      while (true) {
        const beforeWhitespace = position;
        skipWhitespace();
        if (source.startsWith('/>', position)) { position += 2; selfClosing = true; break; }
        if (source[position] === '>') { position += 1; break; }
        if (position === beforeWhitespace) throw new Error('Invalid device response');
        const attribute = readName();
        skipWhitespace();
        if (source[position++] !== '=') throw new Error('Invalid device response');
        skipWhitespace();
        const quote = source[position++];
        if (quote !== '"' && quote !== "'") throw new Error('Invalid device response');
        const end = source.indexOf(quote, position);
        if (end < 0) throw new Error('Invalid device response');
        const content = source.slice(position, end);
        if (content.includes('<')) throw new Error('Invalid device response');
        node.attrs[attribute] = decode(content);
        position = end + 1;
      }
      for (const [key, uri] of Object.entries(node.attrs)) if (key === 'xmlns' || key.startsWith('xmlns:')) node.namespaces[key === 'xmlns' ? '' : key.slice(6)] = uri;
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error('Invalid device response');
  return root;
}
const children = (node, name) => (node?.children ?? []).filter(child => child.name === name);
const child = (node, name) => children(node, name)[0];
const value = (node, name) => child(node, name)?.text ?? '';
function descendants(node, name) { return (node?.children ?? []).flatMap(item => [...(item.name === name ? [item] : []), ...descendants(item, name)]); }
function isLanAddress(address) { return /^(10\.|192\.168\.|169\.254\.|127\.)/.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address); }
function networkUrl(input, base) {
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Unsupported music address');
  return url;
}

function soapEnvelope(service, action, args = {}) {
  if (!service) throw new Error('This player does not support this operation');
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${xml(service.type)}">${Object.entries(args).map(([key, val]) => `<${key}>${xml(val)}</${key}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
}

function parseSoapResponse(input, action) {
  const result = typeof input === 'string' ? parseXml(input) : input;
  const response = descendants(result, `${action}Response`)[0];
  if (!response) throw new Error('Music device returned an invalid response');
  return Object.fromEntries(response.children.map(item => [item.name, item.text]));
}

function parseSoapFault(text) {
  const fault = descendants(parseXml(text), 'UPnPError')[0];
  return fault ? { upnpCode: value(fault, 'errorCode'), upnpDescription: value(fault, 'errorDescription') } : null;
}

function parseDidl(text) {
  const vendor = (item, name) => item.children.find(node => node.name === name && node.namespaces?.[node.qualified.includes(':') ? node.qualified.split(':')[0] : ''] === METADATA)?.text ?? '';
  const optionalNumber = text => text !== '' && Number.isFinite(Number(text)) ? Number(text) : null;
  return descendants(parseXml(text), 'DIDL-Lite').flatMap(root => root.children).map(item => ({
    id: item.attrs.id, parentId: item.attrs.parentID, title: value(item, 'title'), artist: value(item, 'artist'), album: value(item, 'album'),
    isContainer: item.name === 'container', artwork: value(item, 'albumArtURI'), upnpClass: value(item, 'class'),
    childCount: optionalNumber(item.attrs.childCount ?? ''), refId: item.attrs.refID || '',
    genre: value(item, 'genre'), trackNo: optionalNumber(value(item, 'originalTrackNumber')), date: value(item, 'date'),
    viewId: vendor(item, 'view'), addedAt: optionalNumber(vendor(item, 'addedAt')), displayPath: vendor(item, 'displayPath'),
    trackCount: optionalNumber(vendor(item, 'trackCount')), totalDurationSec: optionalNumber(vendor(item, 'totalDurationSec')),
    flatObjectId: vendor(item, 'flatObjectId'), treeObjectId: vendor(item, 'treeObjectId'),
    albumObjectId: vendor(item, 'albumObjectId'), artistObjectId: vendor(item, 'artistObjectId'),
    catalogSearch: vendor(item, 'catalogSearch') === '1',
    resources: children(item, 'res').map(resource => ({ uri: resource.text, protocolInfo: resource.attrs.protocolInfo ?? '', duration: resource.attrs.duration ?? '', size: resource.attrs.size ?? '' }))
  }));
}
function didlItem(item, parentId = '0') {
  const tag = item.isContainer ? 'container' : 'item';
  const fields = { 'dc:title': item.title, 'upnp:class': item.upnpClass || (item.isContainer ? 'object.container' : 'object.item.audioItem.musicTrack'), 'upnp:artist': item.artist, 'upnp:album': item.album, 'upnp:genre': item.genre, 'upnp:originalTrackNumber': item.trackNo, 'dc:date': item.date, 'upnp:albumArtURI': item.artwork, 'et:view': item.viewId, 'et:addedAt': item.addedAt, 'et:displayPath': item.displayPath, 'et:trackCount': item.trackCount, 'et:totalDurationSec': item.totalDurationSec, 'et:flatObjectId': item.flatObjectId, 'et:treeObjectId': item.treeObjectId };
  Object.assign(fields, { 'et:albumObjectId': item.albumObjectId, 'et:artistObjectId': item.artistObjectId, 'et:catalogSearch': item.catalogSearch ? '1' : '', 'et:streamKind': item.streamKind });
  const metadata = Object.entries(fields).filter(([, val]) => val !== undefined && val !== null && val !== '').map(([name, val]) => `<${name}>${xml(val)}</${name}>`).join('');
  const resources = item.isContainer ? [] : item.resources ?? [{ uri: item.uri, protocolInfo: item.protocolInfo ?? 'http-get:*:audio/mpeg:*' }];
  return `<${tag} id="${xml(item.id)}" parentID="${xml(parentId)}" restricted="1"${item.isContainer && Number.isInteger(item.childCount) ? ` childCount="${item.childCount}"` : ''}${item.isContainer ? ' searchable="1"' : item.refId ? ` refID="${xml(item.refId)}"` : ''}>${metadata}${resources.map(res => `<res protocolInfo="${xml(res.protocolInfo)}"${res.size ? ` size="${xml(res.size)}"` : ''}${res.duration ? ` duration="${xml(res.duration)}"` : ''}>${xml(res.uri)}</res>`).join('')}</${tag}>`;
}
const didl = items => `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:et="${METADATA}">${items.join('')}</DIDL-Lite>`;

function* readDescription(input, { location, id, address, expires }) {
  const document = typeof input === 'string' ? parseXml(input) : input;
  location = networkUrl(location);
  const declaredBase = descendants(document, 'URLBase')[0]?.text;
  const base = declaredBase ? networkUrl(declaredBase) : location;
  if (base.hostname !== location.hostname) throw new Error('The music device returned a different address');
  for (const device of descendants(document, 'device')) {
    const udn = value(device, 'UDN'); if (!udn) continue;
    const services = new Map();
    for (const entry of children(child(device, 'serviceList'), 'service')) {
      const type = value(entry, 'serviceType'); const control = networkUrl(value(entry, 'controlURL'), base);
      if (control.hostname !== location.hostname) continue;
      services.set(type.replace(/:\d+$/, ''), { type, control: control.href });
    }
    const endpoint = services.get(REMOTE_CONTROL.replace(/:\d+$/, ''));
    const playerId = value(device, 'playerId');
    if (endpoint && playerId && playerId.length <= 512 && udn === id) {
      const url = new URL(endpoint.control);
      if (url.origin === location.origin && url.pathname === '/.well-known/effetune/pair' && !url.search) {
        yield { remoteControl: { id: udn, playerId, origin: url.origin, address, location: location.href, expires, available: true } };
      }
    }
    if (![...services.keys()].some(type => type.endsWith(':Playlist') || type.endsWith(':ContentDirectory') || type.endsWith(':AVTransport'))) continue;
    yield { device: { id: udn, name: value(device, 'friendlyName') || 'Music device', manufacturer: value(device, 'manufacturer'), services, location: location.href, descriptorHostname: location.hostname, address, expires, available: true } };
  }
}

const service = (device, name) => device?.services.get(`urn:${['ContentDirectory', 'ConnectionManager', 'AVTransport', 'RenderingControl'].includes(name) ? 'schemas-upnp-org' : 'av-openhome-org'}:service:${name}`);

export { CONTENT, CONNECTION, PLAYLIST, REMOTE_CONTROL, MULTICAST, xml, parseXml, child, children, value, descendants, isLanAddress, networkUrl, parseDidl, didlItem, didl, service, soapEnvelope, parseSoapResponse, parseSoapFault, readDescription };

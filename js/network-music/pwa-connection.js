const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function networkMusicError(code) {
  return Object.assign(new Error('The network music request could not be completed.'), { code, networkMusic: true });
}

// Pairing links use private IPv4 literals, which browsers can recognize before
// resolving a host and apply their Local Network Access permission policy to.
export function isPrivateNetworkIPv4(host) {
  const parts = String(host).split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127;
}

export function parsePwaPairingLink(input) {
  if (typeof input !== 'string' || input.length > 1024) throw networkMusicError('invalidPairingLink');
  let url;
  try { url = new URL(input.trim()); } catch { throw networkMusicError('invalidPairingLink'); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash ||
      !isPrivateNetworkIPv4(url.hostname) || !url.port || !['/', '/remote.html'].includes(url.pathname) ||
      [...url.searchParams.keys()].some(key => key !== 't') || url.searchParams.getAll('t').length !== 1 ||
      !TOKEN_PATTERN.test(url.searchParams.get('t'))) throw networkMusicError('invalidPairingLink');
  const protocol = ['https:', 'wss:'].includes(url.protocol) ? 'https:' : 'http:';
  return { origin: `${protocol}//${url.host}`, token: url.searchParams.get('t') };
}

export function validatePwaMediaUrl(value, origin = null) {
  let url;
  try { url = new URL(value); } catch { throw networkMusicError('invalidMediaSource'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search ||
      !isPrivateNetworkIPv4(url.hostname) || origin !== null && url.origin !== origin ||
      !/^\/pwa\/v1\/(?:media|artwork)\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname)) {
    throw networkMusicError('invalidMediaSource');
  }
  return url.href;
}

export function isPwaNetworkMediaUrl(value) {
  try { return validatePwaMediaUrl(value).includes('/pwa/v1/media/'); } catch { return false; }
}

export function isPwaNetworkArtworkUrl(value) {
  try { return validatePwaMediaUrl(value).includes('/pwa/v1/artwork/'); } catch { return false; }
}

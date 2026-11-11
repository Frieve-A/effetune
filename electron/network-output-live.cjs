'use strict';

const { parseXml } = require('./network-music-upnp.cjs');

const DIDL_NAMESPACE = 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/';
const LIVE_NAMESPACE = 'urn:effetune-org:metadata-1-0';
const LIVE_KIND = 'live-pcm-v1';
const LIVE_PCM_TYPE = 'application/vnd.effetune.live-pcm-v1';
const LIVE_CONNECTION_HEADER = 'x-effetune-live-connection';
const LIVE_PATH = /^\/live\/([0-9a-f]{32})$/;
const FEEDBACK_PATH = /^\/live\/([0-9a-f]{32})\/feedback$/;
const LIVE_CONNECTION_ID = /^[0-9a-f]{32}$/;
const LIVE_RECEIVER_ID = /^[A-Za-z0-9_-]{32}$/;
const MAX_FEEDBACK_BYTES = 1024;
const MAX_REPORT_INTERVAL_MS = 300;
const FEEDBACK_FRESHNESS_MS = 3000;
const MAX_DELAY_MS = 10000;

function liveStreamUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && !url.username && !url.password && !url.hash && !url.search &&
      LIVE_PATH.test(url.pathname) ? url : null;
  } catch (_) {
    return null;
  }
}

function inNamespace(node, name, namespace) {
  const colon = node.qualified.indexOf(':');
  const prefix = colon < 0 ? '' : node.qualified.slice(0, colon);
  return node.name === name && Object.hasOwn(node.namespaces, prefix) && node.namespaces[prefix] === namespace;
}

// Metadata classifies an already permitted AVTransport source. The URI and item alone do not identify a live session.
function isLiveNetworkOutput(uri, metadata) {
  const target = liveStreamUrl(uri);
  if (!target || typeof metadata !== 'string') return false;
  try {
    const root = parseXml(metadata);
    if (root.children.length !== 1 || !inNamespace(root.children[0], 'DIDL-Lite', DIDL_NAMESPACE)) return false;
    const items = root.children[0].children;
    if (items.length !== 1 || !inNamespace(items[0], 'item', DIDL_NAMESPACE)) return false;
    const fields = items[0].children;
    const kinds = fields.filter(node => inNamespace(node, 'streamKind', LIVE_NAMESPACE));
    return kinds.length === 1 && kinds[0].children.length === 0 && kinds[0].text.trim() === LIVE_KIND &&
      fields.some(node => inNamespace(node, 'res', DIDL_NAMESPACE) && node.children.length === 0 &&
        liveStreamUrl(node.text.trim())?.href === target.href);
  } catch (_) {
    return false;
  }
}

function validDelay(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DELAY_MS;
}

function readFeedbackRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { connectionId, sessionId, probeId, positionFrames, dspMs, softwareOutputMs, physicalOutputMs, revision } = value;
  if (typeof sessionId !== 'string' || !LIVE_RECEIVER_ID.test(sessionId) ||
      typeof connectionId !== 'string' || !LIVE_CONNECTION_ID.test(connectionId)) return null;
  if (probeId === undefined) return { sessionId, connectionId };
  if (typeof probeId !== 'string' || !LIVE_CONNECTION_ID.test(probeId) ||
      !Number.isFinite(positionFrames) || positionFrames < 1 || positionFrames > Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(revision) || revision < 0 ||
      ![dspMs, softwareOutputMs, physicalOutputMs].every(delay => delay === null || validDelay(delay))) return null;
  return { sessionId, connectionId, probeId, positionFrames, dspMs, softwareOutputMs, physicalOutputMs, revision };
}

module.exports = { LIVE_KIND, LIVE_PCM_TYPE, LIVE_CONNECTION_HEADER, LIVE_PATH, FEEDBACK_PATH, LIVE_CONNECTION_ID,
  MAX_FEEDBACK_BYTES, MAX_REPORT_INTERVAL_MS, FEEDBACK_FRESHNESS_MS, liveStreamUrl, isLiveNetworkOutput, readFeedbackRequest, validDelay };

function normalizeInfo(plugin) {
  const info = plugin?.externalAssetInfo;
  if (!info) return null;
  const ids = Array.isArray(info.ids)
    ? info.ids.filter(id => typeof id === 'string').map(id => id.slice(0, 128))
    : [];
  const protectedIds = Array.isArray(info.protectedIds)
    ? [...new Set(info.protectedIds
      .filter(id => typeof id === 'string')
      .map(id => id.slice(0, 128)))]
    : [];
  const pending = info.pending === true;
  const kind = typeof info.kind === 'string' ? info.kind.slice(0, 32) : '';
  if ((!ids.length && !protectedIds.length && !pending) || (ids.length && !kind)) return null;
  return {
    missing: info.missing === true,
    pending,
    kind,
    ids,
    protectedIds,
    names: Array.isArray(info.names)
      ? info.names.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim().slice(0, 256))
      : []
  };
}

function translate(key, fallback, params = {}) {
  const translated = globalThis.window?.uiManager?.t?.(key, params);
  if (translated && translated !== key) return translated;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    fallback
  );
}

export function collectUniquePipelinePlugins(...pipelines) {
  const plugins = [];
  const seen = new Set();
  for (const pipeline of pipelines) {
    if (!Array.isArray(pipeline)) continue;
    for (const plugin of pipeline) {
      if (!plugin || seen.has(plugin)) continue;
      seen.add(plugin);
      plugins.push(plugin);
    }
  }
  return plugins;
}

export function collectExternalAssetInfo(plugins) {
  return Array.from(plugins || []).map(normalizeInfo).filter(Boolean);
}

export function formatExternalAssetWarning(plugins) {
  const infos = collectExternalAssetInfo(plugins).filter(info => info.ids.length);
  if (!infos.length) return '';
  const kinds = [...new Set(infos.map(info => info.kind))].join('/');
  const names = [...new Set(infos.flatMap(info => info.names))].slice(0, 6);
  return names.length
    ? translate(
      'externalAsset.warningNamed',
      'This pipeline references external {kinds} data ({names}). Recipients must import the same files; they are not included.',
      { kinds, names: names.join(', ') }
    )
    : translate(
      'externalAsset.warning',
      'This pipeline references external {kinds} data. Recipients must import the same files; they are not included.',
      { kinds }
    );
}

export function formatMissingExternalAssetSummary(plugins) {
  const missing = collectExternalAssetInfo(plugins).filter(info => info.missing && info.ids.length);
  if (!missing.length) return '';
  const count = new Set(missing.flatMap(info => info.ids)).size;
  return count === 1
    ? translate(
      'externalAsset.missing.one',
      'One external file could not be found. Import it or choose a substitute in the effect.'
    )
    : translate(
      'externalAsset.missing.many',
      '{count} external files could not be found. Import them or choose substitutes in the effects.',
      { count }
    );
}

export function appendExternalAssetWarning(message, plugins) {
  return appendExternalAssetWarningSnapshot(message, captureExternalAssetWarning(plugins));
}

export function captureExternalAssetWarning(plugins) {
  return formatExternalAssetWarning(plugins);
}

export function appendExternalAssetWarningSnapshot(message, warning) {
  return warning ? `${message} ${warning}` : message;
}

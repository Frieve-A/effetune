import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultHost = process.env.HOST || '127.0.0.1';
const defaultPort = Number.parseInt(process.env.PORT || '8000', 10);
const siteTitle = 'Frieve EffeTune';
const siteDescription = 'Color the music, unleash your senses. Build precise effect chains for streaming, local files, physical sources, measurement, and multichannel playback.';
const pluginCategoryOrder = ['analyzer', 'basics', 'delay', 'dynamics', 'eq', 'lofi', 'modulation', 'others', 'resonator', 'reverb', 'saturation', 'spatial', 'control'];

const mimeTypes = new Map([
  ['.aac', 'audio/aac'],
  ['.css', 'text/css; charset=utf-8'],
  ['.flac', 'audio/flac'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.json5', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.m4a', 'audio/mp4'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.webm', 'audio/webm']
]);

function parseArgs(argv) {
  const options = {
    host: defaultHost,
    port: Number.isFinite(defaultPort) ? defaultPort : 8000
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) {
      options.host = argv[++i];
    } else if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
    } else if (arg === '--port' && argv[i + 1]) {
      options.port = Number.parseInt(argv[++i], 10);
    } else if (arg.startsWith('--port=')) {
      options.port = Number.parseInt(arg.slice('--port='.length), 10);
    }
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function setNoCacheHeaders(response, contentType) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('X-EffeTune-Dev-Server', '1');
  if (contentType) {
    response.setHeader('Content-Type', contentType);
  }
}

function resolveRequestPath(requestUrl, root = repoRoot) {
  let url;
  let decodedPath;
  try {
    url = new URL(requestUrl, 'http://localhost');
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const relativePath = decodedPath.replace(/^\/+/, '') || '.';
  const absolutePath = path.resolve(root, relativePath);

  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return absolutePath;
}

function getStats(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function getDirectoryIndex(directoryPath) {
  const indexPath = path.join(directoryPath, 'index.html');
  return fs.existsSync(indexPath) ? indexPath : null;
}

function getRequestTarget(requestUrl) {
  const sourcePath = resolveRequestPath(requestUrl);

  if (!sourcePath) return { status: 403 };

  const sourceStats = getStats(sourcePath);
  if (sourceStats?.isFile()) {
    return { filePath: sourcePath };
  }

  if (sourceStats?.isDirectory()) {
    const sourceIndexPath = getDirectoryIndex(sourcePath);
    if (sourceIndexPath) {
      return { filePath: sourceIndexPath };
    }
  }

  if (sourceStats?.isDirectory()) {
    return { directoryPath: sourcePath };
  }

  return { status: 404 };
}

function createDevCacheToken(filePath) {
  try {
    return String(Math.trunc(fs.statSync(filePath).mtimeMs));
  } catch {
    return String(Date.now());
  }
}

function cacheBustLocalAsset(assetUrl) {
  if (
    !assetUrl ||
    assetUrl.startsWith('#') ||
    assetUrl.startsWith('data:') ||
    assetUrl.startsWith('javascript:') ||
    assetUrl.startsWith('vbscript:') ||
    /^[a-z][a-z0-9+.-]*:/i.test(assetUrl)
  ) {
    return assetUrl;
  }

  const [withoutHash, hash = ''] = assetUrl.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const extension = path.extname(pathname).toLowerCase();
  if (!mimeTypes.has(extension)) {
    return assetUrl;
  }

  const assetPath = path.resolve(repoRoot, pathname.replace(/^\/+/, ''));
  if (assetPath !== repoRoot && !assetPath.startsWith(`${repoRoot}${path.sep}`)) {
    return assetUrl;
  }

  const separator = query ? '&' : '?';
  const hashPart = hash ? `#${hash}` : '';
  return `${pathname}${query ? `?${query}` : ''}${separator}dev=${createDevCacheToken(assetPath)}${hashPart}`;
}

function cacheBustModuleSpecifier(specifier, importerPath) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }

  const [withoutHash, hash = ''] = specifier.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const assetPath = path.resolve(path.dirname(importerPath), pathname);
  if (assetPath !== repoRoot && !assetPath.startsWith(`${repoRoot}${path.sep}`)) {
    return specifier;
  }

  const separator = query ? '&' : '?';
  const hashPart = hash ? `#${hash}` : '';
  return `${pathname}${query ? `?${query}` : ''}${separator}dev=${createDevCacheToken(assetPath)}${hashPart}`;
}

function injectDevelopmentMode(html) {
  const withAssetCacheBusters = html.replace(
    /\b(src|href)="([^"]+)"/g,
    (match, attribute, assetUrl) => `${attribute}="${cacheBustLocalAsset(assetUrl)}"`
  );
  const marker = 'window.EFFECTUNE_DEV_SERVER = true;';
  if (withAssetCacheBusters.includes(marker)) {
    return withAssetCacheBusters;
  }
  return withAssetCacheBusters.replace(
    '</head>',
    `    <script>${marker}</script>\n</head>`
  );
}

function injectJavaScriptCacheBusters(source, filePath) {
  return source
    .replace(
      /\b((?:import|export)\s+(?:[^'"]*?\s+from\s*)?)(['"])(\.{1,2}\/[^'"]+)\2/g,
      (match, prefix, quote, specifier) => `${prefix}${quote}${cacheBustModuleSpecifier(specifier, filePath)}${quote}`
    )
    .replace(
      /\b(import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2(\s*\))/g,
      (match, prefix, quote, specifier, suffix) => `${prefix}${quote}${cacheBustModuleSpecifier(specifier, filePath)}${quote}${suffix}`
    );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function parseQuotedValue(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseKeyValueLines(source) {
  const output = {};
  source.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      output[match[1]] = parseQuotedValue(match[2]);
    }
  });
  return output;
}

function parseFrontMatter(source) {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { data: {}, content: source };
  }

  const normalized = source.replace(/\r\n/g, '\n');
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { data: {}, content: source };
  }

  const yaml = normalized.slice(4, endIndex);
  return {
    data: parseKeyValueLines(yaml),
    content: normalized.slice(endIndex + '\n---\n'.length)
  };
}

function parseLanguagesData(source) {
  const languages = [];
  let current = null;

  source.split(/\r?\n/).forEach(line => {
    const itemMatch = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (itemMatch) {
      current = { [itemMatch[1]]: parseQuotedValue(itemMatch[2]) };
      languages.push(current);
      return;
    }

    const valueMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (valueMatch && current) {
      current[valueMatch[1]] = parseQuotedValue(valueMatch[2]);
    }
  });

  return languages;
}

function parseSiteUiData(source) {
  const data = {};
  let currentLanguage = null;
  let currentGroup = null;

  source.split(/\r?\n/).forEach(line => {
    if (!line.trim() || line.trim().startsWith('#')) return;

    const languageMatch = line.match(/^([a-z]{2}):\s*$/i);
    if (languageMatch) {
      currentLanguage = languageMatch[1].toLowerCase();
      data[currentLanguage] = {};
      currentGroup = null;
      return;
    }

    const groupMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (groupMatch && currentLanguage) {
      currentGroup = groupMatch[1];
      data[currentLanguage][currentGroup] = {};
      return;
    }

    const valueMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (valueMatch && currentLanguage) {
      currentGroup = null;
      data[currentLanguage][valueMatch[1]] = parseQuotedValue(valueMatch[2]);
      return;
    }

    const nestedMatch = line.match(/^    ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nestedMatch && currentLanguage && currentGroup) {
      data[currentLanguage][currentGroup][nestedMatch[1]] = parseQuotedValue(nestedMatch[2]);
    }
  });

  return data;
}

function readSiteData() {
  if (readSiteData.cache) return readSiteData.cache;

  const languages = parseLanguagesData(fs.readFileSync(path.join(repoRoot, '_data', 'languages.yml'), 'utf8'));
  const ui = parseSiteUiData(fs.readFileSync(path.join(repoRoot, '_data', 'site_ui.yml'), 'utf8'));
  readSiteData.cache = { languages, ui };
  return readSiteData.cache;
}

function getUi(language) {
  const { ui } = readSiteData();
  return ui[language] || ui.en;
}

function expandIncludeRelative(content, filePath) {
  return content.replace(/\{%\s*include_relative\s+([^%\s]+)\s*%\}/g, (match, includePath) => {
    const resolvedPath = path.resolve(path.dirname(filePath), includePath);
    if (resolvedPath !== repoRoot && !resolvedPath.startsWith(`${repoRoot}${path.sep}`)) {
      return match;
    }
    try {
      return fs.readFileSync(resolvedPath, 'utf8');
    } catch {
      return match;
    }
  });
}

function readMarkdownPage(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const parsed = parseFrontMatter(source);
  return {
    data: parsed.data,
    content: expandIncludeRelative(parsed.content, filePath)
  };
}

function stripMarkdownSyntax(value) {
  return String(value)
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~#>|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text) {
  return stripMarkdownSyntax(text)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

function rewriteMarkdownHref(href) {
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return href;
  }

  const hashIndex = href.indexOf('#');
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const hrefPath = hashIndex >= 0 ? href.slice(0, hashIndex) : href;

  if (hrefPath === 'README.md') {
    return `./${hash}`;
  }
  if (hrefPath.endsWith('/README.md')) {
    return `${hrefPath.slice(0, -'README.md'.length)}${hash}`;
  }
  if (hrefPath.endsWith('.md')) {
    return `${hrefPath.slice(0, -'.md'.length)}.html${hash}`;
  }
  return href;
}

function renderInline(text) {
  return String(text)
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, (match, alt, href) => {
      return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(alt)}">`;
    })
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, (match, label, href) => {
      return `<a href="${escapeAttribute(rewriteMarkdownHref(href))}">${renderInlineText(label)}</a>`;
    })
    .replace(/<((?:https?:\/\/)[^>\s]+)>/g, '<a href="$1">$1</a>')
    .replace(/`([^`]+)`/g, (match, code) => `<code>${escapeHtml(code)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderInlineText(text) {
  return String(text)
    .replace(/`([^`]+)`/g, (match, code) => `<code>${escapeHtml(code)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function renderTable(lines, startIndex) {
  const headers = splitTableRow(lines[startIndex]);
  let index = startIndex + 2;
  const rows = [];

  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index++;
  }

  const headerHtml = headers.map(header => `<th>${renderInline(header)}</th>`).join('');
  const rowsHtml = rows.map(row => {
    const cellsHtml = row.map(cell => `<td>${renderInline(cell)}</td>`).join('');
    return `<tr>${cellsHtml}</tr>`;
  }).join('\n');

  return {
    html: `<table>\n<thead><tr>${headerHtml}</tr></thead>\n<tbody>\n${rowsHtml}\n</tbody>\n</table>`,
    nextIndex: index
  };
}

function renderList(lines, startIndex) {
  const ordered = /^\s*\d+\.\s+/.test(lines[startIndex]);
  const tag = ordered ? 'ol' : 'ul';
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (!match) break;
    items.push(`<li>${renderInline(match[1])}</li>`);
    index++;
  }

  return {
    html: `<${tag}>\n${items.join('\n')}\n</${tag}>`,
    nextIndex: index
  };
}

function isRawHtmlStart(line) {
  return /^\s*<(?:div|install|a|img|p|span|section|article|table|thead|tbody|tr|td|th|br|hr)\b/i.test(line);
}

function isSpecialMarkdownLine(line, nextLine) {
  return /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^\s*(?:[-*+]|\d+\.)\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    (line.includes('|') && nextLine && isTableSeparator(nextLine)) ||
    isRawHtmlStart(line);
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index++;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const language = trimmed.slice(3).trim();
      const codeLines = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : '';
      output.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      output.push(`<h${level} id="${escapeAttribute(slugify(heading))}">${renderInline(heading)}</h${level}>`);
      index++;
      continue;
    }

    if (trimmed === '---') {
      output.push('<hr>');
      index++;
      continue;
    }

    if (line.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const table = renderTable(lines, index);
      output.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const list = renderList(lines, index);
      output.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index++;
      }
      output.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    if (isRawHtmlStart(line)) {
      const htmlLines = [];
      while (index < lines.length && lines[index].trim()) {
        htmlLines.push(lines[index]);
        index++;
      }
      output.push(htmlLines.join('\n'));
      continue;
    }

    const paragraphLines = [line.trim()];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isSpecialMarkdownLine(lines[index], lines[index + 1])
    ) {
      paragraphLines.push(lines[index].trim());
      index++;
    }
    output.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
  }

  return output.join('\n');
}

function pageUrlFromPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === 'index.md') return '/';
  if (normalized.endsWith('/index.md')) {
    return `/${normalized.slice(0, -'index.md'.length)}`;
  }
  return `/${normalized.slice(0, -'.md'.length)}.html`;
}

function getLanguageFromPath(relativePath, metadata) {
  const match = relativePath.match(/^docs\/i18n\/([a-z]{2})\//);
  return match ? match[1] : (metadata.lang || 'en');
}

function getMarkdownTitle(metadata, content, fallback) {
  if (metadata.title) return metadata.title;
  const headingMatch = content.match(/^\s*#\s+(.+)$/m);
  if (headingMatch) return stripMarkdownSyntax(headingMatch[1]);
  return fallback;
}

function renderSiteHead({ title, description, image = '/images/ogp.jpg' }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttribute(description || siteDescription)}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0b0f0e">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeAttribute(siteTitle)}">
<meta property="og:title" content="${escapeAttribute(title)}">
<meta property="og:description" content="${escapeAttribute(description || siteDescription)}">
<meta property="og:image" content="${escapeAttribute(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttribute(title)}">
<meta name="twitter:description" content="${escapeAttribute(description || siteDescription)}">
<link rel="icon" href="/images/favicon.ico" type="image/x-icon">
<link rel="icon" href="/images/icon_192x192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" sizes="180x180" href="/images/icon_180x180.png">
<link rel="apple-touch-icon" sizes="192x192" href="/images/icon_192x192.png">
<link rel="manifest" href="/manifest.json">
<link rel="stylesheet" href="/assets/css/site.css">`;
}

function renderHeader(pageLang, relativePath) {
  const { languages } = readSiteData();
  const ui = getUi(pageLang);
  const headerDocsUrl = pageLang === 'en' ? '/#documentation' : `/docs/i18n/${pageLang}/`;
  const headerPluginsUrl = pageLang === 'en' ? '/docs/plugins/eq.html' : `/docs/i18n/${pageLang}/plugins/eq.html`;
  const headerFaqUrl = pageLang === 'en' ? '/docs/faq.html' : `/docs/i18n/${pageLang}/faq.html`;
  const languageJson = JSON.stringify(languages.map(language => ({
    ...language,
    url: language.url
  })), null, 2);
  const uiJson = JSON.stringify(ui.js || {});

  return `<a class="skip-link" href="#main-content">${escapeHtml(ui.skip_to_content)}</a>
<script type="application/json" id="site-language-data">
${languageJson}
</script>
<script type="application/json" id="site-ui-text">
${uiJson}
</script>
<header class="site-header" data-site-header data-page-path="${escapeAttribute(relativePath)}">
  <a class="site-brand" href="/" aria-label="${escapeAttribute(ui.brand_home_label)}">
    <img src="/images/icon_64x64.png" alt="" width="32" height="32">
    <span>Frieve EffeTune</span>
  </a>
  <div class="site-header-actions">
    <nav class="site-nav" id="site-navigation" data-site-nav>
      <a href="/effetune.html">${escapeHtml(ui.nav_open_app)}</a>
      <a href="${escapeAttribute(headerDocsUrl)}">${escapeHtml(ui.nav_docs)}</a>
      <a href="${escapeAttribute(headerPluginsUrl)}">${escapeHtml(ui.nav_plugins)}</a>
      <a href="${escapeAttribute(headerFaqUrl)}">${escapeHtml(ui.nav_faq)}</a>
      <a href="https://github.com/Frieve-A/effetune/releases/">${escapeHtml(ui.nav_download)}</a>
      <a href="https://github.com/Frieve-A/effetune">${escapeHtml(ui.nav_github)}</a>
    </nav>
    <div class="language-switcher">
      <label class="visually-hidden" for="site-language-select">${escapeHtml(ui.language_label)}</label>
      <select id="site-language-select" aria-label="${escapeAttribute(ui.language_label)}" data-language-select>
        ${languages.map(language => `<option value="${escapeAttribute(language.code)}">${escapeHtml(language.label)}</option>`).join('\n        ')}
      </select>
    </div>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-navigation" data-nav-toggle>
      <span></span>
      <span></span>
      <span></span>
    </button>
  </div>
</header>`;
}

function renderFooter(pageLang) {
  const ui = getUi(pageLang);
  return `<footer class="site-footer">
  <div>
    <strong>Frieve EffeTune</strong>
    <span>${escapeHtml(ui.footer_tagline)}</span>
  </div>
  <nav aria-label="${escapeAttribute(ui.footer_label)}">
    <a href="/effetune.html">${escapeHtml(ui.nav_open_app)}</a>
    <a href="/docs/version-history.html">${escapeHtml(ui.version_history)}</a>
    <a href="https://github.com/Frieve-A/effetune">${escapeHtml(ui.nav_github)}</a>
  </nav>
</footer>`;
}

function renderHomeLayout(page, contentHtml) {
  const { languages } = readSiteData();
  return `<!doctype html>
<html lang="en">
<head>
  ${renderSiteHead(page)}
</head>
<body class="site-body home-page">
  ${renderHeader('en', page.relativePath)}
  <main id="main-content">
    <section class="home-hero" style="--hero-image: url('/images/screenshot.png')">
      <div class="hero-content">
        <p class="hero-kicker">Real-time Audio Effect Processor</p>
        <h1>Frieve EffeTune</h1>
        <p class="hero-copy">Color the music, unleash your senses. Build precise effect chains for streaming, local files, physical sources, measurement, and multichannel playback.</p>
        <div class="hero-actions" aria-label="Primary actions">
          <a class="button button-primary" href="/effetune.html">Open Web App</a>
          <install class="button button-secondary"><a href="/effetune.html">Install PWA version</a></install>
          <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Download Desktop App</a>
        </div>
      </div>
    </section>

    <section class="home-metrics" aria-label="Product highlights">
      <dl class="hero-stats">
        <div><dt>50+</dt><dd>professional effects</dd></div>
        <div><dt>8ch</dt><dd>routing and output</dd></div>
        <div><dt>Web + Desktop</dt><dd>same processing model</dd></div>
      </dl>
    </section>

    <section class="home-band" aria-label="Capabilities">
      <div class="section-heading">
        <p>Designed for listening systems</p>
        <h2>From subtle correction to full signal-chain design</h2>
      </div>
      <div class="capability-grid">
        <article><span>01</span><h3>Build chains visually</h3><p>Drag effects into a live pipeline, compare A/B settings, group sections, and save complete presets.</p></article>
        <article><span>02</span><h3>Process real sources</h3><p>Use virtual audio devices, interfaces, HDMI multichannel output, or local files without leaving the app.</p></article>
        <article><span>03</span><h3>Measure and correct</h3><p>Run frequency response measurement, generate correction EQ, and keep analysis tools in the same workflow.</p></article>
      </div>
    </section>

    <section class="home-docs" id="documentation">
      <div class="section-heading">
        <p>Documentation</p>
        <h2>Guides for setup, routing, effects, and development</h2>
      </div>
      <div class="doc-link-grid">
        <a href="/docs/faq.html"><span>Setup and troubleshooting</span><strong>FAQ</strong></a>
        <a href="/docs/bus-function.html"><span>Flexible routing</span><strong>Bus Function</strong></a>
        <a href="/docs/plugins/eq.html"><span>Effect reference</span><strong>Plugin Categories</strong></a>
        <a href="/docs/plugin-development.html"><span>Extend EffeTune</span><strong>Plugin Development</strong></a>
      </div>
      <div class="language-strip" aria-label="Translations">
        ${languages.map(language => `<a href="${escapeAttribute(language.url)}" lang="${escapeAttribute(language.code)}">${escapeHtml(language.short)}</a>`).join('\n        ')}
      </div>
    </section>

    <section class="home-source">
      <div class="section-heading">
        <p>Complete guide</p>
        <h2>Full product guide</h2>
      </div>
      <article class="markdown-body home-source-doc" data-content>
        ${contentHtml}
      </article>
    </section>
  </main>
  ${renderFooter('en')}
  <script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

function getPluginNavLinks(locale) {
  const sourcePrefix = locale ? `docs/i18n/${locale}/plugins/` : 'docs/plugins/';
  return pluginCategoryOrder
    .map(category => {
      const relativePath = `${sourcePrefix}${category}.md`;
      const filePath = path.join(repoRoot, relativePath);
      if (!fs.existsSync(filePath)) return null;
      const page = readMarkdownPage(filePath);
      const title = getMarkdownTitle(page.data, page.content, category).split(' - ')[0];
      return `<a href="${escapeAttribute(pageUrlFromPath(relativePath))}">${escapeHtml(title)}</a>`;
    })
    .filter(Boolean)
    .join('\n                ');
}

function renderDefaultLayout(page, contentHtml) {
  const { languages } = readSiteData();
  const pageLang = page.lang;
  const locale = page.relativePath.match(/^docs\/i18n\/([a-z]{2})\//)?.[1] || '';
  const ui = getUi(pageLang);
  const textDirection = pageLang === 'ar' ? 'rtl' : 'ltr';
  const docsPrefix = locale ? `/docs/i18n/${locale}/` : '/docs/';
  const overviewUrl = locale ? docsPrefix : '/';

  return `<!doctype html>
<html lang="${escapeAttribute(pageLang)}" dir="${textDirection}">
<head>
  ${renderSiteHead(page)}
</head>
<body class="site-body docs-page${textDirection === 'rtl' ? ' is-rtl' : ''}">
  ${renderHeader(pageLang, page.relativePath)}
  <div class="docs-shell">
    <aside class="docs-sidebar" id="docs-sidebar" aria-label="${escapeAttribute(ui.docs_navigation_label)}">
      <div class="docs-sidebar-panel">
        <div class="docs-sidebar-header">
          <h2>${escapeHtml(ui.docs_menu)}</h2>
          <button class="docs-sidebar-close" type="button" aria-label="${escapeAttribute(ui.docs_menu_close_label)}" data-docs-nav-close>&times;</button>
        </div>
        <div class="sidebar-search">
          <label for="doc-search">${escapeHtml(ui.search_docs)}</label>
          <input id="doc-search" type="search" placeholder="${escapeAttribute(ui.search_all_docs)}" autocomplete="off" aria-controls="doc-search-results" data-doc-search data-doc-search-index="${escapeAttribute(`${docsPrefix}search.json`)}">
          <div class="sidebar-search-results" id="doc-search-results" data-doc-search-results hidden></div>
        </div>
        <nav class="sidebar-nav" data-doc-nav>
          <div class="nav-section">
            <h2>${escapeHtml(ui.nav_start)}</h2>
            <a href="${escapeAttribute(overviewUrl)}">${escapeHtml(ui.overview)}</a>
            <a href="${escapeAttribute(`${docsPrefix}faq.html`)}">${escapeHtml(ui.faq_troubleshooting)}</a>
            <a href="${escapeAttribute(`${docsPrefix}bus-function.html`)}">${escapeHtml(ui.bus_function)}</a>
            <a href="${escapeAttribute(`${docsPrefix}double-blind-test.html`)}">${escapeHtml(ui.double_blind_test)}</a>
            <a href="/docs/plugin-development.html">${escapeHtml(ui.plugin_development)}</a>
            <a href="/docs/version-history.html">${escapeHtml(ui.version_history)}</a>
          </div>
          <div class="nav-section">
            <h2>${escapeHtml(ui.plugin_categories)}</h2>
            ${getPluginNavLinks(locale)}
          </div>
          <div class="nav-section nav-section-languages">
            <h2>${escapeHtml(ui.languages)}</h2>
            ${languages.map(language => `<a href="${escapeAttribute(language.url)}" lang="${escapeAttribute(language.code)}">${escapeHtml(language.label)}</a>`).join('\n            ')}
          </div>
        </nav>
      </div>
    </aside>

    <main class="docs-main" id="main-content">
      <div class="doc-topline">
        <span>${escapeHtml(ui.documentation)}</span>
        <div class="doc-actions">
          <button class="docs-menu-open" type="button" aria-expanded="false" aria-controls="docs-sidebar" data-docs-nav-toggle>${escapeHtml(ui.docs_menu)}</button>
          <button class="toc-open" type="button" aria-expanded="false" aria-controls="page-toc" data-toc-toggle>${escapeHtml(ui.on_this_page)}</button>
        </div>
      </div>
      <article class="markdown-body doc-content" data-content>
        ${contentHtml}
      </article>
    </main>

    <aside class="docs-toc" aria-label="${escapeAttribute(ui.on_this_page)}">
      <div class="toc-card">
        <div class="toc-card-header">
          <h2>${escapeHtml(ui.on_this_page)}</h2>
          <button class="toc-close" type="button" aria-label="${escapeAttribute(ui.close_toc_label)}" data-toc-close>&times;</button>
        </div>
        <nav id="page-toc" data-page-toc></nav>
      </div>
    </aside>
  </div>
  ${renderFooter(pageLang)}
  <script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

function renderMarkdownPage(filePath) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const pageSource = readMarkdownPage(filePath);
  const page = {
    relativePath,
    lang: getLanguageFromPath(relativePath, pageSource.data),
    title: getMarkdownTitle(pageSource.data, pageSource.content, siteTitle),
    description: pageSource.data.description || siteDescription,
    image: pageSource.data.image || '/images/ogp.jpg'
  };
  const contentHtml = renderMarkdown(pageSource.content);

  if (relativePath === 'index.md') {
    page.title = 'Frieve EffeTune - Real-time Audio Effect Processor';
    return renderHomeLayout(page, contentHtml);
  }

  return renderDefaultLayout(page, contentHtml);
}

function resolveMarkdownPage(pathname) {
  let relativePath = null;

  if (pathname === '/') {
    relativePath = 'index.md';
  } else if (pathname.endsWith('/')) {
    relativePath = `${pathname.replace(/^\/+/, '')}index.md`;
  } else if (pathname.endsWith('.html')) {
    relativePath = pathname.replace(/^\/+/, '').replace(/\.html$/, '.md');
  } else if (!path.extname(pathname)) {
    relativePath = `${pathname.replace(/^\/+/, '')}/index.md`;
  }

  if (!relativePath || !relativePath.endsWith('.md')) return null;

  const filePath = path.resolve(repoRoot, relativePath);
  if (filePath !== repoRoot && !filePath.startsWith(`${repoRoot}${path.sep}`)) {
    return null;
  }
  return fs.existsSync(filePath) ? filePath : null;
}

function walkMarkdownFiles(directoryPath, output = []) {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(entryPath, output);
    } else if (entry.name.endsWith('.md')) {
      output.push(path.relative(repoRoot, entryPath).replace(/\\/g, '/'));
    }
  }
  return output;
}

function getSearchPagePaths(locale) {
  const docsPages = walkMarkdownFiles(path.join(repoRoot, 'docs')).sort();
  if (locale === 'en') {
    return ['index.md', ...docsPages.filter(relativePath => {
      return !relativePath.startsWith('docs/i18n/') && !relativePath.endsWith('README.md');
    })];
  }

  return docsPages.filter(relativePath => {
    return (relativePath.startsWith(`docs/i18n/${locale}/`) && !relativePath.endsWith('README.md')) ||
      relativePath === 'docs/plugin-development.md' ||
      relativePath === 'docs/version-history.md';
  });
}

function cleanSearchContent(markdown) {
  return stripMarkdownSyntax(markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function renderSearchIndex(locale) {
  const entries = getSearchPagePaths(locale).map(relativePath => {
    const filePath = path.join(repoRoot, relativePath);
    const page = readMarkdownPage(filePath);
    return {
      url: pageUrlFromPath(relativePath),
      title: getMarkdownTitle(page.data, page.content, path.basename(relativePath, '.md')),
      description: page.data.description || '',
      content: cleanSearchContent(page.content)
    };
  });
  return JSON.stringify(entries, null, 2);
}

function getDynamicSiteResponse(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  if (pathname === '/docs/search.json') {
    return { contentType: 'application/json; charset=utf-8', body: renderSearchIndex('en') };
  }

  const localizedSearchMatch = pathname.match(/^\/docs\/i18n\/([a-z]{2})\/search\.json$/);
  if (localizedSearchMatch) {
    return { contentType: 'application/json; charset=utf-8', body: renderSearchIndex(localizedSearchMatch[1]) };
  }

  const markdownPath = resolveMarkdownPage(pathname);
  if (!markdownPath) return null;

  return {
    contentType: 'text/html; charset=utf-8',
    body: injectDevelopmentMode(renderMarkdownPage(markdownPath))
  };
}

function sendText(response, request, contentType, body) {
  setNoCacheHeaders(response, contentType);
  response.writeHead(200);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(body);
}

function sendDirectoryListing(response, requestUrl, directoryPath) {
  const url = new URL(requestUrl, 'http://localhost');
  const rows = fs.readdirSync(directoryPath, { withFileTypes: true })
    .map(entry => {
      const suffix = entry.isDirectory() ? '/' : '';
      const href = path.posix.join(url.pathname, entry.name) + suffix;
      return `<li><a href="${href}">${entry.name}${suffix}</a></li>`;
    })
    .join('\n');
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>EffeTune dev server</title></head>
<body>
<h1>EffeTune dev server</h1>
<ul>
${rows}
</ul>
</body>
</html>`;

  setNoCacheHeaders(response, 'text/html; charset=utf-8');
  response.writeHead(200);
  response.end(body);
}

function sendFile(response, request, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(extension) || 'application/octet-stream';
  setNoCacheHeaders(response, contentType);

  if (request.method === 'HEAD') {
    response.writeHead(200);
    response.end();
    return;
  }

  if (extension === '.html') {
    const html = fs.readFileSync(filePath, 'utf8');
    response.writeHead(200);
    response.end(injectDevelopmentMode(html));
    return;
  }

  if (extension === '.js' || extension === '.mjs') {
    const source = fs.readFileSync(filePath, 'utf8');
    response.writeHead(200);
    response.end(injectJavaScriptCacheBusters(source, filePath));
    return;
  }

  response.writeHead(200);
  fs.createReadStream(filePath).pipe(response);
}

function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    setNoCacheHeaders(response, 'text/plain; charset=utf-8');
    response.writeHead(405);
    response.end('Method Not Allowed');
    return;
  }

  const dynamicSiteResponse = getDynamicSiteResponse(request.url || '/');
  if (dynamicSiteResponse) {
    sendText(response, request, dynamicSiteResponse.contentType, dynamicSiteResponse.body);
    return;
  }

  const target = getRequestTarget(request.url || '/');
  if (target.status === 403) {
    setNoCacheHeaders(response, 'text/plain; charset=utf-8');
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (target.status === 404) {
    setNoCacheHeaders(response, 'text/plain; charset=utf-8');
    response.writeHead(404);
    response.end('Not Found');
    return;
  }

  if (target.directoryPath) {
    sendDirectoryListing(response, request.url || '/', target.directoryPath);
    return;
  }

  sendFile(response, request, target.filePath);
}

export {
  getDynamicSiteResponse,
  handleRequest,
  renderMarkdownPage,
  resolveMarkdownPage
};

function startDevServer(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const server = http.createServer(handleRequest);

  server.listen(options.port, options.host, () => {
    console.log(`EffeTune dev server running at http://${options.host}:${options.port}/`);
    console.log(`Web app: http://${options.host}:${options.port}/effetune.html`);
    console.log(`Site home: http://${options.host}:${options.port}/`);
    console.log(`Japanese docs: http://${options.host}:${options.port}/docs/i18n/ja/`);
    console.log('Press Ctrl+C to stop.');
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDevServer();
}

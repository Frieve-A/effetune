import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readCss(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function getRule(css, selector) {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing selector: ${selector}`);
  const blockStart = css.indexOf('{', selectorIndex);
  const blockEnd = css.indexOf('}', blockStart);
  assert.notEqual(blockStart, -1, `Missing rule start for: ${selector}`);
  assert.notEqual(blockEnd, -1, `Missing rule end for: ${selector}`);
  return css.slice(blockStart + 1, blockEnd);
}

test('desktop view switch buttons match neighboring header icon button size', () => {
  const css = readCss('../../effetune.css');
  const pipelineButtonRule = getRule(css, '.effect-pipeline-button');
  const libraryButtonRule = getRule(css, '.open-library-button');
  const desktopSubtitleContainerRule = getRule(css, 'body:not(.layout-mobile) .subtitle-container');

  assert.match(pipelineButtonRule, /width:\s*36px;/);
  assert.match(pipelineButtonRule, /height:\s*36px;/);
  assert.match(pipelineButtonRule, /padding:\s*8px;/);
  assert.match(libraryButtonRule, /width:\s*36px;/);
  assert.match(libraryButtonRule, /height:\s*36px;/);
  assert.match(libraryButtonRule, /padding:\s*8px;/);
  assert.match(desktopSubtitleContainerRule, /height:\s*36px;/);
});

test('mobile header hides desktop controls and reserves overflow-menu space', () => {
  const css = readCss('../../effetune-mobile.css');

  assert.match(getRule(css, 'body.layout-mobile h1'), /padding-right:\s*48px;/);
  assert.match(getRule(css, 'body.layout-mobile .header-buttons'), /display:\s*none !important;/);
  assert.match(getRule(css, 'body.layout-mobile .header-buttons .effect-pipeline-button'), /display:\s*none !important;/);
  assert.match(getRule(css, 'body.layout-mobile .header-buttons .open-library-button'), /display:\s*none !important;/);
});

test('desktop library view keeps the effect layout width as its sizing basis', () => {
  const css = readCss('../../effetune-library.css');
  const desktopRule = getRule(css, 'body.view-library:not(.layout-mobile) .main-container');
  const mobileRule = getRule(css, 'body.layout-mobile.view-library .main-container');

  assert.match(desktopRule, /visibility:\s*hidden;/);
  assert.match(desktopRule, /height:\s*0;/);
  assert.match(desktopRule, /min-height:\s*0;/);
  assert.match(desktopRule, /overflow:\s*hidden;/);
  assert.doesNotMatch(desktopRule, /display:\s*none;/);
  assert.match(mobileRule, /display:\s*none;/);
});

test('library action status uses an overlay toast without affecting document layout', () => {
  const css = readCss('../../effetune-library.css');
  const toastRule = getRule(css, '.library-paged-action-toast');

  assert.match(toastRule, /position:\s*fixed;/);
  assert.doesNotMatch(css, /\.library-paged-job\b/);
});

test('library playlist actions keep action-bar spacing when controls wrap', () => {
  const css = readCss('../../effetune-library.css');
  const actionsRule = getRule(css, '.library-playlist-actions');

  assert.match(actionsRule, /display:\s*flex;/);
  assert.match(actionsRule, /align-items:\s*center;/);
  assert.match(actionsRule, /flex-wrap:\s*wrap;/);
  assert.match(actionsRule, /gap:\s*8px;/);
  assert.match(actionsRule, /margin:\s*0 0 12px;/);
});

test('library sort options remain readable in the dark theme', () => {
  const css = readCss('../../effetune-library.css');
  const selectRule = getRule(css, '.library-entity-sort-select {');
  const optionRule = getRule(css, '.library-entity-sort-select option');

  assert.match(selectRule, /color-scheme:\s*dark;/);
  assert.match(selectRule, /color:\s*var\(--library-text\);/);
  assert.match(optionRule, /color:\s*var\(--library-text\);/);
  assert.match(optionRule, /background-color:\s*#303030;/);
});

test('mobile library screen keeps scrolling inside the content pane', () => {
  const css = readCss('../../effetune-library.css');
  const bodyRule = getRule(css, 'body.layout-mobile.view-library {');
  const shellRule = getRule(css, 'body.layout-mobile.view-library .mobile-library-view');
  const viewRule = getRule(css, 'body.layout-mobile.view-library .library-view,\nbody.view-library.layout-mobile .library-view');

  assert.match(bodyRule, /display:\s*flex;/);
  assert.match(bodyRule, /flex-direction:\s*column;/);
  assert.match(bodyRule, /height:\s*100svh;/);
  assert.match(bodyRule, /padding-bottom:\s*calc\(var\(--et-bottom-nav-height\) \+ var\(--et-mini-player-height\) \+ env\(safe-area-inset-bottom\) \+ 8px\);/);
  assert.match(bodyRule, /overflow-y:\s*hidden;/);
  assert.match(shellRule, /display:\s*flex;/);
  assert.match(shellRule, /flex:\s*1 1 auto;/);
  assert.match(shellRule, /min-height:\s*0;/);
  assert.match(shellRule, /overflow:\s*hidden;/);
  assert.match(viewRule, /height:\s*100%;/);
  assert.match(viewRule, /min-height:\s*0;/);
  assert.doesNotMatch(viewRule, /padding-bottom:/);
  assert.doesNotMatch(viewRule, /calc\(100vh - 64px\)/);
});

test('paged track rows reveal selection controls only after mobile selection mode starts', () => {
  const css = readCss('../../effetune-library.css');
  const rowRule = getRule(css, 'body.layout-mobile .library-paged-row {');
  const playlistRowRule = getRule(css, 'body.layout-mobile .library-paged-playlist-items .library-paged-row');
  const inactiveRowRule = getRule(
    css,
    'body.layout-mobile .library-view:not(.mobile-selection-mode) .library-paged-row {'
  );
  const inactivePlaylistRowRule = getRule(
    css,
    'body.layout-mobile .library-view:not(.mobile-selection-mode) .library-paged-playlist-items .library-paged-row'
  );
  const hiddenSelectionControlsRule = getRule(
    css,
    'body.layout-mobile .library-view:not(.mobile-selection-mode) .library-paged-select-cell,'
  );
  const hiddenMetadataRule = getRule(
    css,
    'body.layout-mobile .library-paged-tracks .library-paged-row > .library-artist-cell,'
  );
  const selectedRowRule = getRule(
    css,
    'body.layout-mobile .library-view.mobile-selection-mode .library-paged-row.selected'
  );

  assert.match(rowRule, /grid-template-columns:\s*minmax\(28px,\s*auto\)\s*minmax\(0,\s*1fr\)\s*34px;/);
  assert.match(rowRule, /-webkit-touch-callout:\s*none;/);
  assert.match(playlistRowRule, /grid-template-columns:\s*minmax\(28px,\s*auto\)\s*minmax\(0,\s*1fr\)\s*34px\s*110px;/);
  assert.match(inactiveRowRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*34px;/);
  assert.match(inactivePlaylistRowRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*34px\s*110px;/);
  assert.match(hiddenSelectionControlsRule, /display:\s*none;/);
  assert.match(
    css,
    /body\.layout-mobile \.library-view:not\(\.mobile-selection-mode\) \.library-paged-select-all,\s*body\.layout-mobile \.library-view:not\(\.mobile-selection-mode\) \.library-paged-deselect-all\s*\{/
  );
  assert.doesNotMatch(
    css,
    /body\.layout-mobile \.library-view:not\(\.mobile-selection-mode\) \.library-paged-actions\s*\{[^}]*display:\s*none;/
  );
  assert.match(selectedRowRule, /background:\s*rgba\(74,\s*158,\s*255,\s*0\.18\);/);
  assert.doesNotMatch(css, /\n\.library-paged-row\.selected\s*\{/);
  assert.match(hiddenMetadataRule, /display:\s*none;/);
  assert.doesNotMatch(hiddenMetadataRule, /library-paged-playlist-row-actions/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.library-paged-row/);
});

test('desktop library view uses measured viewport height with a usable minimum', () => {
  const css = readCss('../../effetune-library.css');
  const rootRule = getRule(css, ':root');
  const desktopLibraryRule = getRule(css, 'body.view-library:not(.layout-mobile) .library-view');

  assert.match(rootRule, /--library-desktop-min-height:\s*360px;/);
  assert.match(desktopLibraryRule, /height:\s*var\(--library-desktop-height,\s*calc\(100vh - 180px\)\);/);
  assert.match(desktopLibraryRule, /min-height:\s*var\(--library-desktop-min-height\);/);
});

test('desktop library panels match the audio player inner spacing', () => {
  const appCss = readCss('../../effetune.css');
  const libraryCss = readCss('../../effetune-library.css');
  const audioPlayerRule = getRule(appCss, '.audio-player');
  const desktopLibraryNavRule = getRule(libraryCss, 'body.view-library:not(.layout-mobile) .library-nav');
  const desktopLibraryHeaderRule = getRule(libraryCss, 'body.view-library:not(.layout-mobile) .library-header');

  assert.match(audioPlayerRule, /padding:\s*20px;/);
  assert.match(desktopLibraryNavRule, /padding:\s*20px;/);
  assert.match(desktopLibraryHeaderRule, /padding:\s*20px;/);
});

test('desktop library content keeps the scrollbar inside the right inset', () => {
  const css = readCss('../../effetune-library.css');
  const contentRule = getRule(css, '.library-content');
  const desktopContentRule = getRule(css, 'body.view-library:not(.layout-mobile) .library-content');

  assert.match(contentRule, /min-width:\s*0;/);
  assert.match(contentRule, /overflow-anchor:\s*none;/);
  assert.match(contentRule, /padding:\s*14px;/);
  assert.match(desktopContentRule, /padding:\s*20px max\(0px,\s*calc\(20px - var\(--library-content-scrollbar-width,\s*0px\)\)\) 20px 20px;/);
});

test('desktop library track headers align with track row columns', () => {
  const css = readCss('../../effetune-library.css');
  const headerRule = getRule(css, '.library-track-header {');
  const rowRule = getRule(css, '\n.library-paged-row {\n');
  const desktopRowRule = getRule(css, 'body:not(.layout-mobile) .library-paged-tracks .library-paged-row');
  const columnPattern = /grid-template-columns:\s*([^;]+);/;

  assert.equal(headerRule.match(columnPattern)?.[1], rowRule.match(columnPattern)?.[1]);
  assert.match(headerRule, /gap:\s*10px;/);
  assert.match(rowRule, /gap:\s*10px;/);
  assert.match(headerRule, /padding:\s*0;/);
  assert.match(desktopRowRule, /padding-right:\s*0;/);
  assert.match(desktopRowRule, /padding-left:\s*0;/);
});

test('library metadata stays within the content width for long values', () => {
  const css = readCss('../../effetune-library.css');
  const desktopLibraryRule = getRule(css, 'body.view-library:not(.layout-mobile) .library-view');
  const sectionRule = getRule(css, '.library-section-head {');
  const sectionTitleRule = getRule(css, '.library-section-head h2 {');
  const sectionCountRule = getRule(css, '.library-section-head > span');
  const simpleListRule = getRule(css, '.library-simple-list {');
  const simpleRowRule = getRule(css, '.library-simple-row {');
  const simpleValueRule = getRule(css, '.library-simple-row > span {');
  const simpleNameRule = getRule(css, '.library-simple-row > span:first-child');
  const simpleCountRule = getRule(css, '.library-simple-row > span:last-child');
  const detailRule = getRule(css, '.library-detail-head {\n  align-items: flex-start;');
  const detailCopyRule = getRule(css, '.library-detail-head > div:last-child');
  const detailTextRule = getRule(css, '.library-detail-head h2,\n.library-detail-head p');
  const metadataCellRule = getRule(css, '.library-track-title,\n.library-link');

  assert.match(desktopLibraryRule, /contain:\s*inline-size;/);
  assert.match(sectionRule, /min-width:\s*0;/);
  assert.match(sectionRule, /max-width:\s*100%;/);
  assert.match(sectionRule, /justify-content:\s*flex-start;/);
  assert.match(sectionTitleRule, /flex:\s*0 1 auto;/);
  assert.match(sectionTitleRule, /min-width:\s*0;/);
  assert.match(sectionTitleRule, /overflow:\s*hidden;/);
  assert.match(sectionTitleRule, /text-overflow:\s*ellipsis;/);
  assert.match(sectionTitleRule, /white-space:\s*nowrap;/);
  assert.match(sectionCountRule, /flex:\s*0 0 auto;/);
  assert.match(sectionCountRule, /min-width:\s*0;/);
  assert.match(simpleListRule, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(simpleListRule, /min-width:\s*0;/);
  assert.match(simpleListRule, /max-width:\s*100%;/);
  assert.match(simpleRowRule, /box-sizing:\s*border-box;/);
  assert.match(simpleRowRule, /width:\s*100%;/);
  assert.match(simpleRowRule, /min-width:\s*0;/);
  assert.match(simpleRowRule, /max-width:\s*100%;/);
  assert.match(simpleValueRule, /min-width:\s*0;/);
  assert.match(simpleValueRule, /overflow-wrap:\s*anywhere;/);
  assert.match(simpleNameRule, /flex:\s*1 1 auto;/);
  assert.match(simpleCountRule, /flex:\s*0 1 auto;/);
  assert.match(detailRule, /min-width:\s*0;/);
  assert.match(detailRule, /max-width:\s*100%;/);
  assert.match(detailCopyRule, /flex:\s*1 1 auto;/);
  assert.match(detailCopyRule, /min-width:\s*0;/);
  assert.match(detailCopyRule, /max-width:\s*100%;/);
  assert.match(detailTextRule, /overflow-wrap:\s*anywhere;/);
  assert.match(metadataCellRule, /min-width:\s*0;/);
  assert.match(metadataCellRule, /overflow:\s*hidden;/);
  assert.match(metadataCellRule, /text-overflow:\s*ellipsis;/);
  assert.match(metadataCellRule, /white-space:\s*nowrap;/);
});

test('desktop library view hides the plugin list toggle button', () => {
  const css = readCss('../../effetune-library.css');
  const desktopSidebarRule = getRule(css, 'body.view-library:not(.layout-mobile) .sidebar-button');

  assert.match(desktopSidebarRule, /display:\s*none;/);
});

test('library status actions align to the library content inner edge', () => {
  const css = readCss('../../effetune-library.css');
  const statusRule = getRule(css, '.library-status');
  const desktopStatusButtonRule = getRule(css, 'body.view-library:not(.layout-mobile) .library-status-button');
  const mobileStatusRule = getRule(css, 'body.layout-mobile .library-status');

  assert.match(statusRule, /padding:\s*0 calc\(14px \+ var\(--library-content-scrollbar-width,\s*0px\)\) 0 14px;/);
  assert.match(desktopStatusButtonRule, /padding:\s*0 20px;/);
  assert.match(mobileStatusRule, /padding:\s*0 10px;/);
});

test('library navigation counts align lower with their labels', () => {
  const css = readCss('../../effetune-library.css');
  const navItemRule = getRule(css, '.library-nav-item');
  const countRule = getRule(css, '.library-count');

  assert.match(navItemRule, /align-items:\s*center;/);
  assert.match(countRule, /position:\s*relative;/);
  assert.match(countRule, /top:\s*0\.12em;/);
  assert.match(countRule, /margin-left:\s*6px;/);
});

test('desktop empty library icon has a bounded display size', () => {
  const css = readCss('../../effetune-library.css');
  const emptyIconRule = getRule(css, 'body.view-library:not(.layout-mobile) .library-empty-icon');

  assert.match(emptyIconRule, /width:\s*96px;/);
  assert.match(emptyIconRule, /max-width:\s*42%;/);
});

test('paged library artwork images stay centered within the artwork frame', () => {
  const css = readCss('../../effetune-library.css');
  const artworkRule = getRule(css, '.library-paged-artwork {');
  const imageRule = getRule(css, '.library-artwork-image');

  assert.match(artworkRule, /box-sizing:\s*border-box;/);
  assert.match(artworkRule, /overflow:\s*hidden;/);
  assert.match(imageRule, /display:\s*block;/);
  assert.match(imageRule, /width:\s*100%;/);
  assert.match(imageRule, /height:\s*100%;/);
  assert.match(imageRule, /min-width:\s*0;/);
  assert.match(imageRule, /min-height:\s*0;/);
  assert.match(imageRule, /max-width:\s*100%;/);
  assert.match(imageRule, /max-height:\s*100%;/);
  assert.match(imageRule, /object-fit:\s*contain;/);
  assert.match(imageRule, /object-position:\s*center;/);
});

test('library album card play button uses the mobile primary player styling', () => {
  const css = readCss('../../effetune-library.css');
  const playRule = getRule(css, '.library-card-play {');
  const iconRule = getRule(css, '.library-card-play svg');

  assert.match(playRule, /width:\s*42px;/);
  assert.match(playRule, /height:\s*42px;/);
  assert.match(playRule, /color:\s*#ffffff;/);
  assert.match(playRule, /background:\s*linear-gradient\(180deg,\s*rgba\(255,\s*255,\s*255,\s*0\.22\)/);
  assert.match(playRule, /linear-gradient\(180deg,\s*#67b9ff,\s*#3f8fe8\);/);
  assert.match(playRule, /border:\s*1px solid #8ccaff;/);
  assert.match(playRule, /box-shadow:\s*0 12px 28px rgba\(74,\s*158,\s*255,\s*0\.32\)/);
  assert.match(playRule, /transition:[^;]*transform 0\.12s ease;/);
  assert.match(iconRule, /width:\s*18px;/);
  assert.match(iconRule, /height:\s*18px;/);
});

test('library card play buttons use equal horizontal and vertical artwork insets', () => {
  const css = readCss('../../effetune-library.css');
  const playRule = getRule(css, '.library-card-play {');
  const artworkRule = getRule(css, '.library-paged-media-card .library-paged-artwork');
  const titleRule = getRule(css, '.library-card-title {');

  assert.match(artworkRule, /grid-area:\s*1 \/ 1;/);
  assert.match(artworkRule, /margin-bottom:\s*0;/);
  assert.match(playRule, /grid-area:\s*1 \/ 1;/);
  assert.match(playRule, /place-self:\s*end;/);
  assert.match(playRule, /margin:\s*0 12px 12px 0;/);
  assert.match(titleRule, /margin-top:\s*8px;/);
  assert.doesNotMatch(playRule, /(?:^|\s)(?:right|top):/);
});

test('mobile library card metadata stays below artwork without changing the desktop card grid', () => {
  const css = readCss('../../effetune-library.css');
  const cardRule = getRule(css, '.library-paged-media-card');
  const mobileMediaCardRule = getRule(
    css,
    'body.layout-mobile .library-paged-row.library-paged-entity-card.library-paged-media-card'
  );
  const titleRule = getRule(
    css,
    'body.layout-mobile .library-paged-media-card > .library-card-title'
  );
  const subtitleRule = getRule(
    css,
    'body.layout-mobile .library-paged-media-card > .library-card-subtitle'
  );

  assert.doesNotMatch(cardRule, /grid-template-columns:/);
  assert.match(mobileMediaCardRule, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(titleRule, /grid-area:\s*2 \/ 1;/);
  assert.match(subtitleRule, /grid-area:\s*3 \/ 1;/);
});

test('paged media-card artwork keeps the v2 square frame and record placeholder', () => {
  const css = readCss('../../effetune-library.css');
  const cardRule = getRule(css, '.library-paged-row.library-paged-entity-card.library-paged-media-card');
  const artworkRule = getRule(css, '.library-paged-artwork {');
  const placeholderRule = getRule(css, '.library-paged-artwork > span,\n.library-paged-artwork.library-artwork-error::after');
  const imageRule = getRule(css, '.library-paged-artwork .library-artwork-image');

  assert.match(cardRule, /grid-template-rows:\s*auto auto auto;/);
  assert.match(artworkRule, /box-sizing:\s*border-box;/);
  assert.match(artworkRule, /aspect-ratio:\s*1;/);
  assert.match(artworkRule, /background:\s*linear-gradient\(135deg,\s*#3a3a3a,\s*#292929\);/);
  assert.match(artworkRule, /border:\s*1px solid var\(--library-border\);/);
  assert.match(placeholderRule, /width:\s*42%;/);
  assert.match(placeholderRule, /border:\s*2px solid #565656;/);
  assert.match(placeholderRule, /box-shadow:\s*inset 0 0 0 12px #282828;/);
  assert.match(imageRule, /object-fit:\s*contain;/);
});

test('paged entity cards keep inter-card spacing while reaching both grid edges', () => {
  const css = readCss('../../effetune-library.css');
  const cardRule = getRule(css, '.library-paged-row.library-paged-entity-card');
  const folderRule = getRule(css, '.library-paged-grid .library-paged-folder-row');
  const nameRule = getRule(css, '.library-paged-folder-main');
  const statusRule = getRule(css, '.library-paged-folder-row > .library-badge');
  const actionsRule = getRule(css, '.library-paged-folder-actions');

  assert.match(cardRule, /padding:\s*8px 0;/);
  assert.match(folderRule, /grid-template:\s*minmax\(0,\s*1fr\) auto auto \/ minmax\(0,\s*1fr\);/);
  assert.match(folderRule, /border:\s*solid transparent;/);
  assert.match(folderRule, /border-width:\s*8px 0;/);
  assert.match(folderRule, /background-clip:\s*padding-box;/);
  assert.match(folderRule, /box-shadow:\s*inset 0 0 0 1px var\(--library-border/);
  assert.match(nameRule, /grid-row:\s*1;/);
  assert.match(nameRule, /grid-column:\s*1 \/ -1;/);
  assert.match(statusRule, /grid-row:\s*2;/);
  assert.match(statusRule, /grid-column:\s*1 \/ -1;/);
  assert.match(statusRule, /justify-self:\s*start;/);
  assert.match(actionsRule, /grid-row:\s*3;/);
});

test('library album card titles reserve line height for descenders', () => {
  const css = readCss('../../effetune-library.css');
  const titleRule = getRule(css, '.library-card-title {');

  assert.match(titleRule, /font-size:\s*14px;/);
  assert.match(titleRule, /line-height:\s*1\.35;/);
  assert.match(titleRule, /min-height:\s*1\.35em;/);
});

test('library icon buttons keep a 30px content square', () => {
  const css = readCss('../../effetune-library.css');
  const iconButtonRule = getRule(css, '.library-icon-button {');

  assert.match(iconButtonRule, /box-sizing:\s*content-box;/);
  assert.match(iconButtonRule, /width:\s*30px;/);
  assert.match(iconButtonRule, /height:\s*30px;/);
  assert.match(iconButtonRule, /padding:\s*0;/);
});

test('library view reuses the main effect surface theme', () => {
  const css = readCss('../../effetune-library.css');
  const rootRule = getRule(css, ':root');
  const viewRule = getRule(css, '.library-view');
  const searchRule = getRule(css, '.library-search {');

  assert.match(rootRule, /--library-bg:\s*var\(--et-panel-gradient,/);
  assert.match(rootRule, /--library-panel-strong:\s*var\(--et-card-gradient,/);
  assert.match(rootRule, /--library-input:\s*var\(--et-input-gradient,/);
  assert.doesNotMatch(rootRule, /--library-bg:\s*#0/);
  assert.doesNotMatch(rootRule, /--library-panel:\s*#1/);
  assert.match(viewRule, /box-shadow:\s*var\(--library-shadow\);/);
  assert.match(searchRule, /background:\s*var\(--library-input\);/);
});

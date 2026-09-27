const ICONS = Object.freeze({
  add: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
});

export class ExtensionMobileShell {
  constructor({
    documentRef = globalThis.document,
    translate = (_key, fallback) => fallback
  } = {}) {
    this.document = documentRef;
    this.translate = translate;
    this.fab = null;
    this.closeButton = null;
  }

  applyMode(mode) {
    if (mode === 'mobile') {
      this.ensureElements();
      return;
    }
    this.removeElements();
  }

  ensureElements() {
    if (!this.fab) {
      const label = this.translate('ui.mobileNav.addEffect', 'Add effect');
      this.fab = this.document.createElement('button');
      this.fab.type = 'button';
      this.fab.className = 'mobile-plugin-fab';
      this.fab.setAttribute('aria-label', label);
      this.fab.title = label;
      this.fab.innerHTML = ICONS.add;
      this.fab.addEventListener('click', () => this.openPluginList());
      this.document.body.appendChild(this.fab);
    }

    if (!this.closeButton) {
      const label = this.translate('ui.mobileNav.closeEffectList', 'Close effect list');
      this.closeButton = this.document.createElement('button');
      this.closeButton.type = 'button';
      this.closeButton.className = 'mobile-plugin-list-close';
      this.closeButton.setAttribute('aria-label', label);
      this.closeButton.title = label;
      this.closeButton.innerHTML = ICONS.close;
      this.closeButton.addEventListener('click', () => this.closePluginList());
      this.document.getElementById('pluginList')?.prepend(this.closeButton);
    }
  }

  openPluginList() {
    this.document.getElementById('pluginList')?.classList.add('mobile-open');
  }

  closePluginList() {
    this.document.getElementById('pluginList')?.classList.remove('mobile-open');
  }

  // The extension editor has a single view, so Visualizer Back returns to the pipeline.
  getCurrentView() { return 'effects'; }

  setView() {}

  removeElements() {
    this.closePluginList();
    this.fab?.remove();
    this.closeButton?.remove();
    this.fab = null;
    this.closeButton = null;
  }

  dispose() {
    this.removeElements();
  }
}

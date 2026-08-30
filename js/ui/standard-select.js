const managers = new WeakMap();

function dispatchSelectEvent(select, type) {
  const EventConstructor = select.ownerDocument?.defaultView?.Event;
  if (typeof EventConstructor === 'function') {
    select.dispatchEvent(new EventConstructor(type, { bubbles: true }));
  }
}

class StandardSelectManager {
  constructor(documentRef) {
    this.document = documentRef;
    this.window = documentRef.defaultView;
    this.activeSelect = null;
    this.activeIndex = -1;
    this.typeAhead = '';
    this.typeAheadTimer = null;
    this.pointerSelect = null;
    this.nextListId = 1;
    this.list = documentRef.createElement('div');
    this.list.className = 'standard-select-list';
    this.list.hidden = true;
    this.list.setAttribute('role', 'listbox');
    documentRef.body.appendChild(this.list);

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleViewportChange = this.handleViewportChange.bind(this);
    documentRef.addEventListener('pointerdown', this.handlePointerDown, true);
    documentRef.addEventListener('click', this.handleClick, true);
    documentRef.addEventListener('keydown', this.handleKeyDown, true);
    this.window.addEventListener('resize', this.handleViewportChange);
    this.window.addEventListener('scroll', this.handleViewportChange, true);
  }

  enhance(select) {
    if (select.dataset.standardSelect === 'true') return select;
    select.dataset.standardSelect = 'true';
    select.setAttribute('aria-haspopup', 'listbox');
    select.setAttribute('aria-expanded', 'false');
    return select;
  }

  isEnhancedSelect(element) {
    return element?.tagName === 'SELECT' && element.dataset.standardSelect === 'true';
  }

  handlePointerDown(event) {
    const select = event.target?.closest?.('select[data-standard-select="true"]');
    if (select && !select.disabled && event.button === 0) {
      event.preventDefault();
      this.pointerSelect = select;
      select.focus({ preventScroll: true });
      if (this.activeSelect === select) this.close();
      else this.open(select);
      return;
    }
    if (this.activeSelect && !this.list.contains(event.target)) this.close();
  }

  handleClick(event) {
    const select = event.target?.closest?.('select[data-standard-select="true"]');
    if (!select || select.disabled) return;
    event.preventDefault();
    if (this.pointerSelect === select) {
      this.pointerSelect = null;
      return;
    }
    if (this.activeSelect === select) this.close();
    else this.open(select);
  }

  handleKeyDown(event) {
    const select = event.target;
    if (!this.isEnhancedSelect(select) || select.disabled) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.activeSelect !== select) this.open(select);
      else this.moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (this.activeSelect !== select) this.open(select);
      this.activateBoundary(event.key === 'Home' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.activeSelect === select) this.commitActive();
      else this.open(select);
      return;
    }
    if (event.key === 'Escape') {
      if (this.activeSelect === select) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      }
      return;
    }
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.handleTypeAhead(select, event.key);
    }
  }

  handleTypeAhead(select, character) {
    clearTimeout(this.typeAheadTimer);
    this.typeAhead += character.toLocaleLowerCase();
    this.typeAheadTimer = this.window.setTimeout(() => {
      this.typeAhead = '';
      this.typeAheadTimer = null;
    }, 700);
    if (this.activeSelect !== select) this.open(select);
    const options = Array.from(select.options);
    const start = Math.max(0, this.activeIndex + 1);
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset) % options.length;
      if (!options[index].disabled && options[index].textContent.trim().toLocaleLowerCase().startsWith(this.typeAhead)) {
        this.setActive(index);
        break;
      }
    }
  }

  open(select) {
    this.close();
    if (!select.isConnected || select.disabled || select.options.length === 0) return;
    this.activeSelect = select;
    this.activeIndex = select.selectedIndex >= 0 ? select.selectedIndex : this.firstEnabledIndex();
    const dialogLayer = select.closest('.library-dialog-backdrop, .modal-overlay');
    (dialogLayer || this.document.body).appendChild(this.list);
    const listId = `standard-select-list-${this.nextListId++}`;
    this.list.id = listId;
    select.setAttribute('aria-controls', listId);
    select.setAttribute('aria-expanded', 'true');
    this.render();
    this.list.style.font = this.window.getComputedStyle(select).font;
    this.list.hidden = false;
    this.position();
    this.updateActive();
  }

  close() {
    clearTimeout(this.typeAheadTimer);
    this.typeAhead = '';
    this.typeAheadTimer = null;
    if (this.activeSelect) {
      this.activeSelect.setAttribute('aria-expanded', 'false');
      this.activeSelect.removeAttribute('aria-controls');
      this.activeSelect.removeAttribute('aria-activedescendant');
    }
    this.activeSelect = null;
    this.activeIndex = -1;
    this.list.hidden = true;
    this.list.replaceChildren();
  }

  render() {
    const select = this.activeSelect;
    this.list.replaceChildren();
    Array.from(select.options).forEach((option, index) => {
      const row = this.document.createElement('button');
      row.type = 'button';
      row.id = `${this.list.id}-option-${index}`;
      row.className = 'standard-select-option';
      row.textContent = option.textContent;
      row.disabled = option.disabled;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === select.selectedIndex));
      row.addEventListener('pointermove', () => {
        if (!row.disabled) this.setActive(index);
      });
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', () => this.commit(index));
      this.list.appendChild(row);
    });
  }

  firstEnabledIndex() {
    return Array.from(this.activeSelect?.options || []).findIndex(option => !option.disabled);
  }

  moveActive(direction) {
    const options = Array.from(this.activeSelect?.options || []);
    if (options.length === 0) return;
    let index = this.activeIndex;
    for (let count = 0; count < options.length; count++) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) {
        this.setActive(index);
        return;
      }
    }
  }

  activateBoundary(direction) {
    const options = Array.from(this.activeSelect?.options || []);
    const start = direction > 0 ? 0 : options.length - 1;
    for (let index = start; index >= 0 && index < options.length; index += direction) {
      if (!options[index].disabled) {
        this.setActive(index);
        return;
      }
    }
  }

  setActive(index) {
    this.activeIndex = index;
    this.updateActive();
  }

  updateActive() {
    Array.from(this.list.children).forEach((row, index) => {
      const active = index === this.activeIndex;
      row.classList.toggle('active', active);
      if (active) {
        this.activeSelect?.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  commitActive() {
    if (this.activeIndex >= 0) this.commit(this.activeIndex);
  }

  commit(index) {
    const select = this.activeSelect;
    const option = select?.options[index];
    if (!select || !option || option.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    this.close();
    select.focus({ preventScroll: true });
    if (changed) {
      dispatchSelectEvent(select, 'input');
      dispatchSelectEvent(select, 'change');
    }
  }

  position() {
    const select = this.activeSelect;
    if (!select?.isConnected || this.list.hidden) return;
    const computedZoom = Number.parseFloat(
      this.document.body ? this.window.getComputedStyle?.(this.document.body)?.zoom : ''
    );
    const inlineZoom = Number.parseFloat(this.document.body?.style?.zoom);
    const bodyZoom = Number.isFinite(computedZoom) && computedZoom > 0
      ? computedZoom
      : (Number.isFinite(inlineZoom) && inlineZoom > 0 ? inlineZoom : 1);
    const viewportWidth = (
      this.window.innerWidth || this.document.documentElement.clientWidth || 0
    ) / bodyZoom;
    const viewportHeight = (
      this.window.innerHeight || this.document.documentElement.clientHeight || 0
    ) / bodyZoom;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    const renderedRect = select.getBoundingClientRect();
    const rect = {
      left: renderedRect.left / bodyZoom,
      right: renderedRect.right / bodyZoom,
      top: renderedRect.top / bodyZoom,
      bottom: renderedRect.bottom / bodyZoom,
      width: renderedRect.width / bodyZoom
    };
    const margin = 8;
    const gap = 4;
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin);
    const availableAbove = Math.max(0, rect.top - gap - margin);
    // Clear a previous opening's inline cap so the shared CSS limit applies
    // while measuring and a short list can shrink back to its content.
    this.list.style.maxHeight = '';
    const contentHeight = this.list.scrollHeight;
    const verticalChrome = this.list.offsetHeight - this.list.clientHeight;
    const cssMaxHeight = Number.parseFloat(this.window.getComputedStyle(this.list).maxHeight);
    const standardMaxHeight = Number.isFinite(cssMaxHeight) ? cssMaxHeight : viewportHeight;
    const viewportMaxHeight = Math.max(0, viewportHeight - 40);
    const desiredHeight = Math.min(contentHeight + verticalChrome, standardMaxHeight, viewportMaxHeight);
    const openAbove = desiredHeight > availableBelow && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    const height = Math.min(desiredHeight, availableHeight);
    const width = Math.min(rect.width, Math.max(0, viewportWidth - margin * 2));
    const left = Math.min(Math.max(margin, rect.left), viewportWidth - margin - width);
    const top = openAbove ? rect.top - gap - height : rect.bottom + gap;
    Object.assign(this.list.style, {
      left: `${left}px`,
      top: `${Math.max(margin, top)}px`,
      width: `${width}px`,
      maxHeight: `${height}px`
    });
  }

  handleViewportChange() {
    if (!this.activeSelect) return;
    if (!this.activeSelect.isConnected) this.close();
    else this.position();
  }
}

function managerFor(select) {
  const documentRef = select?.ownerDocument;
  if (!documentRef?.defaultView || !documentRef.body || typeof select.getBoundingClientRect !== 'function') {
    return null;
  }
  let manager = managers.get(documentRef);
  if (!manager) {
    manager = new StandardSelectManager(documentRef);
    managers.set(documentRef, manager);
  }
  return manager;
}

export function enableStandardSelect(select) {
  managerFor(select)?.enhance(select);
  return select;
}

export function enableStandardSelects(root) {
  root?.querySelectorAll?.('select.config-select').forEach(enableStandardSelect);
}

export function closeStandardSelect(documentRef) {
  managers.get(documentRef)?.close();
}

export function isStandardSelectOpen(documentRef) {
  return Boolean(managers.get(documentRef)?.activeSelect);
}

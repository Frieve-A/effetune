function parseAttributes(source) {
  const attrs = {};
  const pattern = /([:\w-]+)(?:="([^"]*)")?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2] ?? true;
  }
  return attrs;
}

function parseSelectedOptionValue(html) {
  const optionPattern = /<option\b([^>]*)>/g;
  let firstValue = '';
  let match;
  while ((match = optionPattern.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (!firstValue && typeof attrs.value === 'string') {
      firstValue = attrs.value;
    }
    if (attrs.selected === true && typeof attrs.value === 'string') {
      return attrs.value;
    }
  }
  return firstValue;
}

function parseSelectValue(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selectPattern = new RegExp(`<select\\b[^>]*id="${escapedId}"[^>]*>([\\s\\S]*?)<\\/select>`, 'i');
  const match = selectPattern.exec(html);
  return match ? parseSelectedOptionValue(match[1]) : '';
}

export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.attributes = {};
    this.className = '';
    this.id = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.disabled = false;
    this.textContent = '';
    this.style = {};
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (this.tagName === 'SELECT') {
      this.value = parseSelectedOptionValue(value);
    }
    this.ownerDocument.registerElementsFromHTML(value, this);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
    this[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      if (!this.value || child.selected) {
        this.value = child.value;
      }
    }
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  dispatchEvent(type, event = {}) {
    const listeners = this.eventListeners.get(type) || [];
    const eventObject = { target: this, ...event };
    const results = [];
    for (const listener of listeners) {
      results.push(listener(eventObject));
    }
    return Promise.all(results);
  }

  querySelectorAll(selector) {
    return this.ownerDocument.querySelectorAll(selector);
  }
}

export function createFakeDocument(options = {}) {
  const elementsById = new Map();
  const allElements = [];
  const omittedIds = new Set(options.omitIds || []);
  const documentListeners = new Map();

  const document = {
    elementsById,
    allElements,
    body: null,
    head: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, document);
      allElements.push(element);
      return element;
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="pipeline"]') {
        return allElements.filter(element => element.tagName === 'INPUT' && element.name === 'pipeline');
      }
      return [];
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, []);
      }
      documentListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!documentListeners.has(type)) {
        return;
      }
      documentListeners.set(
        type,
        documentListeners.get(type).filter(candidate => candidate !== listener)
      );
    },
    dispatchEvent(type, event = {}) {
      const listeners = documentListeners.get(type) || [];
      const results = [];
      for (const listener of listeners) {
        results.push(listener(event));
      }
      return Promise.all(results);
    },
    listenerCount(type) {
      return (documentListeners.get(type) || []).length;
    },
    registerElementsFromHTML(html, parent) {
      const elementPattern = /<(input|select|option|button|label|h2|div)\b([^>]*)>/gi;
      let match;
      while ((match = elementPattern.exec(html)) !== null) {
        const tagName = match[1];
        const attrs = parseAttributes(match[2]);
        if (!attrs.id || omittedIds.has(attrs.id)) {
          continue;
        }
        const element = new FakeElement(tagName, document);
        allElements.push(element);
        element.parentNode = parent;
        element.id = attrs.id;
        element.name = attrs.name || '';
        element.value = tagName.toLowerCase() === 'select'
          ? parseSelectValue(html, attrs.id)
          : attrs.value || '';
        element.checked = attrs.checked === true;
        element.selected = attrs.selected === true;
        element.disabled = attrs.disabled === true;
        element.attributes = attrs;
        elementsById.set(element.id, element);
        parent.children.push(element);
      }
    }
  };

  document.body = document.createElement('body');
  document.head = document.createElement('head');

  return document;
}

export class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = {};
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.clickCount = 0;
    this._textContent = '';
    this.canvasCalls = [];
  }

  set textContent(value) {
    this._textContent = String(value);
    if (value === '') this.children = [];
  }

  get textContent() { return this._textContent; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (this.tagName === 'SELECT' && !this.value) this.value = child.value;
    return child;
  }

  append(...children) { children.forEach(child => this.appendChild(child)); }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  removeAttribute(name) { delete this.attributes[name]; }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    await Promise.all((this.listeners.get(type) || []).map(listener => listener({ target: this, ...event })));
  }

  contains(target) {
    return target === this || this.children.some(child => child.contains(target));
  }

  focus() {
    this.focused = true;
    if (globalThis.document) globalThis.document.activeElement = this;
  }

  querySelectorAll() {
    return flatten(this).slice(1).filter(element =>
      !element.disabled && !element.hidden &&
      (element.tagName === 'BUTTON' || element.tagName === 'INPUT' || element.tagName === 'SELECT' ||
        (element.attributes.tabindex !== undefined && element.attributes.tabindex !== '-1'))
    );
  }

  click() {
    this.clickCount += 1;
    return this.dispatch('click');
  }

  getContext() {
    if (this.tagName !== 'CANVAS') return null;
    const call = name => (...args) => this.canvasCalls.push([name, ...args]);
    return {
      clearRect: call('clearRect'),
      beginPath: call('beginPath'),
      moveTo: call('moveTo'),
      lineTo: call('lineTo'),
      stroke: call('stroke'),
      set strokeStyle(value) { this._strokeStyle = value; }
    };
  }
}

export const flatten = root => [root, ...root.children.flatMap(flatten)];
export const byClass = (root, className) => flatten(root).filter(element => element.className === className);
export const buttons = root => flatten(root).filter(element => element.tagName === 'BUTTON');
export const button = (root, text) => buttons(root).find(element => element.textContent === text);
export const rowName = row => flatten(row).find(element => element.tagName === 'STRONG')?.textContent;
export const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};
export const nextTurn = () => new Promise(resolve => setImmediate(resolve));

import {
  IR_LIBRARY_INDEX_TOO_LARGE_CODE,
  maxIrCacheBytesForName,
  maxIrLibraryBytesForName,
  requireBoundedIrBytes
} from './ir-library-limits.js';
import { requireLibraryNamespace } from './library-namespace.js';

function responseData(response, allowedCode = null) {
  if (response?.ok === true) return response.data;
  const indexTooLarge = allowedCode === IR_LIBRARY_INDEX_TOO_LARGE_CODE &&
    response?.code === IR_LIBRARY_INDEX_TOO_LARGE_CODE;
  const error = new Error(indexTooLarge
    ? 'The IR library index is too large.'
    : 'The IR library storage request failed.');
  if (indexTooLarge) error.code = IR_LIBRARY_INDEX_TOO_LARGE_CODE;
  throw error;
}

export class ElectronIrLibraryBackend {
  constructor(bridge, namespace = 'ir-library') {
    if (!bridge || bridge.apiVersion !== 1) throw new Error('The IR library bridge is unavailable.');
    this.bridge = bridge;
    this.namespace = requireLibraryNamespace(namespace);
  }

  async read(name) {
    const allowedCode = name === 'index.json' ? IR_LIBRARY_INDEX_TOO_LARGE_CODE : null;
    const data = responseData(await this.bridge.read({ name, namespace: this.namespace }), allowedCode);
    if (data === null) return null;
    requireBoundedIrBytes(data, maxIrLibraryBytesForName(name, this.namespace), 'IR library item');
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  async exists(name) {
    return responseData(await this.bridge.exists({ name, namespace: this.namespace })) === true;
  }

  async writeAtomic(name, bytes) {
    requireBoundedIrBytes(bytes, maxIrLibraryBytesForName(name, this.namespace), 'IR library item');
    responseData(await this.bridge.writeAtomic({ name, bytes, namespace: this.namespace }));
  }

  async remove(name) {
    responseData(await this.bridge.remove({ name, namespace: this.namespace }));
  }

  async list() {
    return responseData(await this.bridge.list({ namespace: this.namespace }));
  }

  async cleanupTemporary() {
    responseData(await this.bridge.cleanupTemporary({ namespace: this.namespace }));
  }

  async readCache(name) {
    const data = responseData(await this.bridge.readCache({ name, namespace: this.namespace }));
    if (data === null) return null;
    requireBoundedIrBytes(data, maxIrCacheBytesForName(name), 'IR cache item');
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  async writeCacheAtomic(name, bytes) {
    requireBoundedIrBytes(bytes, maxIrCacheBytesForName(name), 'IR cache item');
    responseData(await this.bridge.writeCacheAtomic({ name, bytes, namespace: this.namespace }));
  }

  async removeCache(name) {
    responseData(await this.bridge.removeCache({ name, namespace: this.namespace }));
  }

  async listCache() {
    return responseData(await this.bridge.listCache({ namespace: this.namespace }));
  }
}

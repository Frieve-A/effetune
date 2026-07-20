import {
  IR_LIBRARY_INDEX_TOO_LARGE_CODE,
  maxIrCacheBytesForName,
  maxIrLibraryBytesForName,
  requireBoundedIrBytes
} from './ir-library-limits.js';

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
  constructor(bridge) {
    if (!bridge || bridge.apiVersion !== 1) throw new Error('The IR library bridge is unavailable.');
    this.bridge = bridge;
  }

  async read(name) {
    const allowedCode = name === 'index.json' ? IR_LIBRARY_INDEX_TOO_LARGE_CODE : null;
    const data = responseData(await this.bridge.read({ name }), allowedCode);
    if (data === null) return null;
    requireBoundedIrBytes(data, maxIrLibraryBytesForName(name), 'IR library item');
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  async exists(name) {
    return responseData(await this.bridge.exists({ name })) === true;
  }

  async writeAtomic(name, bytes) {
    requireBoundedIrBytes(bytes, maxIrLibraryBytesForName(name), 'IR library item');
    responseData(await this.bridge.writeAtomic({ name, bytes }));
  }

  async remove(name) {
    responseData(await this.bridge.remove({ name }));
  }

  async list() {
    return responseData(await this.bridge.list({}));
  }

  async cleanupTemporary() {
    responseData(await this.bridge.cleanupTemporary({}));
  }

  async readCache(name) {
    const data = responseData(await this.bridge.readCache({ name }));
    if (data === null) return null;
    requireBoundedIrBytes(data, maxIrCacheBytesForName(name), 'IR cache item');
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  async writeCacheAtomic(name, bytes) {
    requireBoundedIrBytes(bytes, maxIrCacheBytesForName(name), 'IR cache item');
    responseData(await this.bridge.writeCacheAtomic({ name, bytes }));
  }

  async removeCache(name) {
    responseData(await this.bridge.removeCache({ name }));
  }

  async listCache() {
    return responseData(await this.bridge.listCache({}));
  }
}

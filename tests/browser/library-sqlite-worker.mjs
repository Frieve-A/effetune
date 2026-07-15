import { WebSqliteCatalogRepository } from '../../js/library/repository/web-catalog-repository.js';

const MAX_MESSAGE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
let repository = null;

self.addEventListener('message', event => {
  void handleRequest(event.data);
});

async function handleRequest(request) {
  const requestBytes = measureBytes(request);
  if (requestBytes > MAX_MESSAGE_BYTES) {
    postFailure(request?.id, createError('requestTooLarge', 'Test request exceeds 1 MiB'));
    return;
  }
  try {
    if (!request || !Number.isSafeInteger(request.id) || typeof request.method !== 'string' || !Array.isArray(request.args)) {
      throw createError('invalidRequest', 'Invalid browser catalog test request');
    }
    let result;
    if (request.method === 'open') {
      if (repository) throw createError('alreadyOpen', 'Test catalog is already open');
      repository = new WebSqliteCatalogRepository({
        authority: 'test',
        clearOnInit: request.args[0]?.clearOnInit === true
      });
      result = await repository.open();
    } else if (request.method === 'close') {
      repository?.close();
      repository = null;
      result = { closed: true };
    } else {
      if (!repository || typeof repository[request.method] !== 'function') {
        throw createError('unsupportedMethod', 'Unsupported browser catalog test method');
      }
      result = await repository[request.method](...request.args);
    }
    postResult(request.id, result, requestBytes);
  } catch (error) {
    postFailure(request?.id, error, requestBytes);
  }
}

function postResult(id, result, requestBytes) {
  const response = { id, ok: true, result, requestBytes };
  const responseBytes = measureBytes({ ...response, responseBytes: MAX_MESSAGE_BYTES });
  if (responseBytes > MAX_MESSAGE_BYTES) {
    postFailure(id, createError('responseTooLarge', 'Test response exceeds 1 MiB'), requestBytes);
    return;
  }
  response.responseBytes = responseBytes;
  self.postMessage(response);
}

function postFailure(id, error, requestBytes = 0) {
  const response = {
    id: Number.isSafeInteger(id) ? id : 0,
    ok: false,
    error: {
      name: String(error?.name ?? 'Error'),
      code: String(error?.code ?? 'catalogError'),
      message: String(error?.message ?? 'Catalog request failed')
    },
    requestBytes
  };
  response.responseBytes = measureBytes({ ...response, responseBytes: MAX_MESSAGE_BYTES });
  self.postMessage(response);
}

function measureBytes(value) {
  let binaryBytes = 0;
  const json = JSON.stringify(value, (_key, item) => {
    if (ArrayBuffer.isView(item)) {
      binaryBytes += item.byteLength;
      return { binaryByteLength: item.byteLength };
    }
    if (item instanceof ArrayBuffer) {
      binaryBytes += item.byteLength;
      return { binaryByteLength: item.byteLength };
    }
    return item;
  });
  return encoder.encode(json ?? '').byteLength + binaryBytes;
}

function createError(code, message) {
  return Object.assign(new Error(message), { code });
}

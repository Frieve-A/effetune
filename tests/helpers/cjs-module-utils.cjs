const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function loadFreshModule(modulePath) {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

function withPatchedProperty(object, property, value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  Object.defineProperty(object, property, {
    configurable: true,
    writable: true,
    value
  });

  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(object, property, descriptor);
    } else {
      delete object[property];
    }
  }
}

async function withPatchedPropertyAsync(object, property, value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  Object.defineProperty(object, property, {
    configurable: true,
    writable: true,
    value
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(object, property, descriptor);
    } else {
      delete object[property];
    }
  }
}

function withMutedConsole(method, callback) {
  return withPatchedProperty(console, method, () => {}, callback);
}

async function withMutedConsoleAsync(method, callback) {
  return await withPatchedPropertyAsync(console, method, () => {}, callback);
}

function withModuleLoadStub(stubs, callback) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return callback();
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = {
  createTempDir,
  loadFreshModule,
  withMutedConsole,
  withMutedConsoleAsync,
  withModuleLoadStub,
  withPatchedProperty,
  withPatchedPropertyAsync
};

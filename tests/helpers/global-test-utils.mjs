export function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  };
}

export function createConsoleHarness(overrides = {}) {
  return Object.assign(Object.create(globalThis.console), overrides);
}

export async function withGlobals(globals, callback) {
  const restore = Object.entries(globals).map(([name, value]) => replaceGlobal(name, value));
  try {
    return await callback();
  } finally {
    for (let i = restore.length - 1; i >= 0; i--) {
      restore[i]();
    }
  }
}

export async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

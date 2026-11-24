export function createArchiveCache(idleMs = 5000) {
  let current;
  async function retire(slot) {
    clearTimeout(slot.timer);
    if (current === slot) current = undefined;
    if (slot.users === 0 && !slot.closed) {
      slot.closed = true;
      await slot.resource?.close?.();
    }
  }
  return { async use(key, open, callback) {
    let slot = current;
    if (!slot || slot.key !== key) {
      if (slot) retire(slot).catch(error => console.warn('Archive close failed', error));
      slot = { key, users: 0, closed: false, pending: Promise.resolve().then(open) };
      current = slot;
    }
    slot.users++;
    clearTimeout(slot.timer);
    try {
      try { slot.resource = await slot.pending; }
      catch (error) { if (current === slot) current = undefined; throw error; }
      return await callback(slot.resource.archive);
    } finally {
      if (--slot.users === 0) {
        if (current !== slot) await retire(slot);
        else {
          slot.timer = setTimeout(() => retire(slot).catch(error => console.warn('Archive close failed', error)), idleMs);
          slot.timer.unref?.();
        }
      }
    }
  } };
}

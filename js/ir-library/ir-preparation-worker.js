import { emitPreparedIr, getIrPreparationTransferables, prepareIr } from './ir-preparation.js';

self.addEventListener('message', event => {
  const { id, operation = 'prepare', request } = event.data || {};
  if (!Number.isInteger(id)) return;
  try {
    const result = operation === 'emit' ? emitPreparedIr(request) : prepareIr(request);
    self.postMessage({ id, result }, getIrPreparationTransferables(result));
  } catch (error) {
    self.postMessage({
      id,
      error: 'The impulse response could not be prepared.',
      diagnostic: error instanceof Error ? error.message : String(error)
    });
  }
});

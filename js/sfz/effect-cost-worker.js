import { instantiateDspBinding } from '../audio/dsp-engine-binding.js';
import { sfzPreparationContext } from './preparation-context.js';

export function attachSfzEffectCostWorker(endpoint, instantiate = instantiateDspBinding) {
  let binding;
  let queue = Promise.resolve();
  endpoint.onmessage = ({ data }) => {
    queue = queue.then(async () => {
      try {
        if (data.type === 'module') {
          binding?.close();
          binding = await instantiate(data.module);
          endpoint.postMessage({ id: data.id, ok: true });
        } else if (data.type === 'estimate') {
          if (!binding) throw new Error('DSP sizing module is unavailable');
          const bytes = binding.estimateSfzEffectPreparation(data.control, sfzPreparationContext(data.context), data.formatTag, data.payloadBytes);
          endpoint.postMessage({ id: data.id, ok: true, bytes });
        } else throw new Error('Unknown instrument preparation operation');
      } catch (error) {
        console.error('SFZ effect sizing failed:', error);
        endpoint.postMessage({ id: data.id, ok: false });
      }
    });
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) attachSfzEffectCostWorker(globalThis);

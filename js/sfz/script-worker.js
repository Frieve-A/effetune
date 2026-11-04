import { compileSfzScript } from './script-compiler.js';

export async function compileSfzScriptAsync(source) {
  if (typeof Worker === 'undefined') return compileSfzScript(source);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./script-worker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    worker.onmessage = ({ data }) => {
      if (data.error) finish(Object.assign(new Error(data.error.message), data.error));
      else finish(null, data.result);
    };
    worker.onerror = () => finish(Object.assign(new Error('The instrument script could not be prepared.'), { code: 'script-invalid' }));
    worker.postMessage({ source });
  });
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({ data }) => {
    try {
      const result = compileSfzScript(data.source);
      globalThis.postMessage({ result }, [result.bytes.buffer]);
    } catch (error) {
      globalThis.postMessage({ error: { code: error.code, line: error.line, message: error.message } });
    }
  };
}

import { loadReferencePlugin } from '../../tools/dsp-parity/node-host.mjs';

export async function getCurrentJsEngineHash(type, repoRoot) {
  const { jsEngineHash } = await loadReferencePlugin(type, { repoRoot });
  return jsEngineHash;
}

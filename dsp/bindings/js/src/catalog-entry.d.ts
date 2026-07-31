import type { EffectChannel } from './generated-effects.js';

export declare function getEffectCatalog(): Readonly<{
  version: 1;
  channels: readonly EffectChannel[];
  effects: readonly Readonly<Record<string, unknown>>[];
}>;

export declare const EFFECT_CATALOG: ReturnType<typeof getEffectCatalog>;

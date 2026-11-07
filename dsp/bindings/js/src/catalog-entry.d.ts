import type { EffectChannel, EffectType } from './generated-effects.js';

export interface EffectCatalogParameter {
  readonly name: string;
  readonly type: string;
  readonly count: number;
  readonly default: string | number | boolean | readonly (string | number | boolean)[];
  readonly values?: readonly (string | number | boolean)[];
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumLength?: number;
  readonly pattern?: string;
}

export interface EffectCatalogEntry {
  readonly type: EffectType;
  readonly parameters: readonly EffectCatalogParameter[];
  readonly seeded: boolean;
  readonly telemetry: readonly string[];
  readonly latency: {
    readonly kind: string;
    readonly dependsOn?: readonly string[];
  };
  readonly assets: readonly {
    readonly name: string;
    readonly kind: string;
    readonly required: boolean;
  }[];
  readonly sampleRates?: readonly number[];
  readonly minimumSampleRate?: number;
  readonly effectiveDelaySamples?: number;
}

export declare function getEffectCatalog(): Readonly<{
  version: 1;
  channels: readonly EffectChannel[];
  effects: readonly EffectCatalogEntry[];
}>;

export declare const EFFECT_CATALOG: ReturnType<typeof getEffectCatalog>;

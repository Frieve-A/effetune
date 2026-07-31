import type { EffectChannel, EffectType } from './generated-effects.js';

export declare const EFFECT_CHANNELS: readonly EffectChannel[];

export declare class Effect {
  readonly type: EffectType;
  readonly id?: string;
  readonly enabled: boolean;
  readonly channel: EffectChannel;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly assets?: Readonly<Record<string, string>>;
  constructor(type: EffectType, options?: Readonly<Record<string, unknown>>);
  toJSON(): EffectDefinition;
}

export interface EffectDefinition {
  readonly id?: string;
  readonly type: EffectType;
  readonly enabled?: boolean;
  readonly channel?: EffectChannel;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly assets?: Readonly<Record<string, string>>;
}

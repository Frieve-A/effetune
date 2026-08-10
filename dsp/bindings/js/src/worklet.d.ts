import type {
  ArtifactOptions,
  AssetResolver,
  BundleDocument,
  ChainDocumentInput,
  ChainEffectInput,
  TelemetryCallback
} from './index.js';
import type { Effect } from './effect.js';

export interface EffeTuneNodeOptions extends ArtifactOptions {
  readonly channels?: number;
  readonly seed?: number;
  readonly assetResolver?: AssetResolver | { resolve: AssetResolver };
  readonly processorUrl?: string | URL;
}

export declare class EffeTuneNode extends AudioWorkletNode {
  private constructor();
  static create(
    context: BaseAudioContext,
    input: string | ChainDocumentInput | BundleDocument |
      readonly (Effect | ChainEffectInput)[],
    options?: EffeTuneNodeOptions
  ): Promise<EffeTuneNode>;
  readonly latencySamples: number;
  readonly droppedTelemetryFrames: number;
  subscribe(callback: TelemetryCallback): () => void;
  unsubscribe(callback: TelemetryCallback): boolean;
  setParam(effectId: string, parameterName: string, value: unknown): Promise<void>;
  reset(): Promise<void>;
  close(): void;
}

/**
 * Minimal ambient types for onnxruntime-web — the package ships types.d.ts
 * but its exports map doesn't expose it under the bundler resolution used by
 * tsconfig. Only the surface Smart Ink uses is declared here.
 */
declare module "onnxruntime-web" {
  export const env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
      proxy?: boolean;
      simd?: boolean;
    };
    logLevel: "verbose" | "info" | "warning" | "error" | "fatal";
  };

  export class Tensor {
    constructor(
      type: "float32" | "uint8" | "int32" | "int64",
      data: Float32Array | Uint8Array | Int32Array | BigInt64Array,
      dims: readonly number[],
    );
    readonly dims: readonly number[];
    readonly data: Float32Array;
    dispose(): void;
  }

  export class InferenceSession {
    static create(
      model: ArrayBuffer | Uint8Array,
      options?: {
        executionProviders?: string[];
        graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
      },
    ): Promise<InferenceSession>;
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
  }
}

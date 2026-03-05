import { decode } from "@toon-format/toon";
import type { Spec, StreamChunk, SpecDataPart } from "@json-render/core";
import { SPEC_DATA_PART_TYPE } from "@json-render/core";

/**
 * Streaming compiler that accumulates TOON text and attempts incremental
 * decoding as more lines arrive.
 *
 * Unlike the JSONL patch-based compiler in core, this compiler buffers a
 * TOON document and decodes it each time new content arrives.
 * Partial specs are returned as soon as the root and at least one element
 * can be decoded.
 */
export interface ToonStreamCompiler {
  /** Push a chunk of TOON text. Returns the latest decodable spec (or null). */
  push(chunk: string): { result: Spec | null; updated: boolean };
  /** Get the current compiled result */
  getResult(): Spec | null;
  /** Get the accumulated TOON text */
  getBuffer(): string;
  /** Reset the compiler */
  reset(): void;
}

/**
 * Create a streaming TOON compiler.
 *
 * As TOON text streams in from an LLM, push chunks into this compiler.
 * It attempts to decode the accumulated TOON after each push and returns
 * the latest valid spec.
 *
 * @example
 * ```ts
 * const compiler = createToonStreamCompiler();
 *
 * for await (const chunk of stream) {
 *   const { result, updated } = compiler.push(chunk);
 *   if (updated && result) {
 *     setSpec(result); // Update UI with partial spec
 *   }
 * }
 *
 * const finalSpec = compiler.getResult();
 * ```
 */
export function createToonStreamCompiler(): ToonStreamCompiler {
  let buffer = "";
  let lastResult: Spec | null = null;
  let lastSuccessfulBuffer = "";

  function tryDecode(): { result: Spec | null; updated: boolean } {
    if (buffer === lastSuccessfulBuffer) {
      return { result: lastResult, updated: false };
    }

    try {
      const raw = decode(buffer, { strict: false }) as Record<string, unknown>;

      if (
        typeof raw.root === "string" &&
        raw.elements &&
        typeof raw.elements === "object"
      ) {
        const spec = raw as unknown as Spec;
        const prevJson = lastResult ? JSON.stringify(lastResult) : "";
        const nextJson = JSON.stringify(spec);
        const updated = prevJson !== nextJson;
        lastResult = spec;
        lastSuccessfulBuffer = buffer;
        return { result: spec, updated };
      }
    } catch {
      // Partial TOON — not yet decodable, keep buffering
    }

    return { result: lastResult, updated: false };
  }

  return {
    push(chunk: string): { result: Spec | null; updated: boolean } {
      buffer += chunk;
      return tryDecode();
    },

    getResult(): Spec | null {
      tryDecode();
      return lastResult;
    },

    getBuffer(): string {
      return buffer;
    },

    reset(): void {
      buffer = "";
      lastResult = null;
      lastSuccessfulBuffer = "";
    },
  };
}

/**
 * Creates a `TransformStream` that intercepts AI SDK UI message stream chunks
 * and detects TOON spec blocks inside ` ```toon ` / ` ``` ` fences.
 *
 * When a complete TOON block is found, it is decoded and emitted as a
 * `data-spec` part with `type: "flat"`.
 * Text outside fences is forwarded as normal text deltas.
 *
 * @example
 * ```ts
 * import { createToonTransform } from "@json-render/toon";
 *
 * const stream = createUIMessageStream({
 *   execute: async ({ writer }) => {
 *     writer.merge(
 *       result.toUIMessageStream().pipeThrough(createToonTransform()),
 *     );
 *   },
 * });
 * ```
 */
export function createToonTransform(): TransformStream<
  StreamChunk,
  StreamChunk
> {
  let lineBuffer = "";
  let inToonFence = false;
  let toonBuffer = "";
  let inTextBlock = false;
  let currentTextId = "";
  let textIdCounter = 0;

  function closeTextBlock(
    controller: TransformStreamDefaultController<StreamChunk>,
  ) {
    if (inTextBlock) {
      controller.enqueue({ type: "text-end", id: currentTextId });
      inTextBlock = false;
    }
  }

  function ensureTextBlock(
    controller: TransformStreamDefaultController<StreamChunk>,
  ) {
    if (!inTextBlock) {
      textIdCounter++;
      currentTextId = String(textIdCounter);
      controller.enqueue({ type: "text-start", id: currentTextId });
      inTextBlock = true;
    }
  }

  function emitTextDelta(
    delta: string,
    controller: TransformStreamDefaultController<StreamChunk>,
  ) {
    ensureTextBlock(controller);
    controller.enqueue({ type: "text-delta", id: currentTextId, delta });
  }

  function emitSpec(
    spec: Spec,
    controller: TransformStreamDefaultController<StreamChunk>,
  ) {
    closeTextBlock(controller);
    controller.enqueue({
      type: SPEC_DATA_PART_TYPE,
      data: { type: "flat", spec } satisfies SpecDataPart,
    });
  }

  function processCompleteLine(
    line: string,
    controller: TransformStreamDefaultController<StreamChunk>,
  ) {
    const trimmed = line.trim();

    if (!inToonFence && trimmed.startsWith("```toon")) {
      inToonFence = true;
      toonBuffer = "";
      return;
    }

    if (inToonFence && trimmed === "```") {
      inToonFence = false;
      try {
        const raw = decode(toonBuffer, { strict: false }) as Record<
          string,
          unknown
        >;
        if (
          typeof raw.root === "string" &&
          raw.elements &&
          typeof raw.elements === "object"
        ) {
          emitSpec(raw as unknown as Spec, controller);
        }
      } catch {
        // Failed to decode — emit as text
        emitTextDelta(toonBuffer, controller);
      }
      toonBuffer = "";
      return;
    }

    if (inToonFence) {
      toonBuffer += line + "\n";
      return;
    }

    if (trimmed) {
      emitTextDelta(line + "\n", controller);
    } else {
      emitTextDelta("\n", controller);
    }
  }

  return new TransformStream<StreamChunk, StreamChunk>({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "text-start": {
          const id = (chunk as { id: string }).id;
          const idNum = parseInt(id, 10);
          if (!isNaN(idNum) && idNum >= textIdCounter) {
            textIdCounter = idNum;
          }
          currentTextId = id;
          inTextBlock = true;
          controller.enqueue(chunk);
          break;
        }

        case "text-delta": {
          const delta = chunk as { id: string; delta: string };
          const text = delta.delta;

          for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);

            if (ch === "\n") {
              if (lineBuffer) {
                processCompleteLine(lineBuffer, controller);
                lineBuffer = "";
              } else if (!inToonFence) {
                emitTextDelta("\n", controller);
              }
            } else {
              lineBuffer += ch;
            }
          }
          break;
        }

        case "text-end": {
          if (lineBuffer) {
            processCompleteLine(lineBuffer, controller);
            lineBuffer = "";
          }
          if (inTextBlock) {
            controller.enqueue({ type: "text-end", id: currentTextId });
            inTextBlock = false;
          }
          break;
        }

        default: {
          controller.enqueue(chunk);
          break;
        }
      }
    },

    flush(controller) {
      if (lineBuffer) {
        processCompleteLine(lineBuffer, controller);
        lineBuffer = "";
      }

      if (inToonFence && toonBuffer) {
        try {
          const raw = decode(toonBuffer, { strict: false }) as Record<
            string,
            unknown
          >;
          if (
            typeof raw.root === "string" &&
            raw.elements &&
            typeof raw.elements === "object"
          ) {
            emitSpec(raw as unknown as Spec, controller);
          }
        } catch {
          emitTextDelta(toonBuffer, controller);
        }
      }

      closeTextBlock(controller);
    },
  });
}

/**
 * Convenience wrapper that pipes an AI SDK UI message stream through the
 * TOON transform, detecting and decoding TOON spec blocks.
 *
 * @example
 * ```ts
 * import { pipeToonRender } from "@json-render/toon";
 *
 * const stream = createUIMessageStream({
 *   execute: async ({ writer }) => {
 *     writer.merge(pipeToonRender(result.toUIMessageStream()));
 *   },
 * });
 * ```
 */
export function pipeToonRender<T = StreamChunk>(
  stream: ReadableStream<T>,
): ReadableStream<T> {
  return stream.pipeThrough(
    createToonTransform() as unknown as TransformStream<T, T>,
  );
}

/**
 * TOON (Token-Oriented Object Notation) utilities for json-render.
 *
 * TOON is a compact, line-oriented data format that encodes the JSON data model
 * with 30-60% fewer tokens than JSON. These utilities convert between the
 * internal Spec type and TOON format for LLM I/O.
 *
 * @see https://toonformat.dev
 */

import { encode, decode } from "@toon-format/toon";
import type { Spec, JsonPatch, SpecStreamLine } from "./types";
import { setByPath } from "./types";

// =============================================================================
// Encoding — Spec/State/Patches → TOON
// =============================================================================

/**
 * Encode a Spec object to TOON format.
 *
 * Used for:
 * - Including the current spec in refinement prompts
 * - Displaying specs in TOON for debugging
 *
 * @example
 * ```ts
 * const spec: Spec = { root: "main", elements: { ... }, state: { ... } };
 * const toon = encodeSpecToToon(spec);
 * // root: main
 * // elements:
 * //   main:
 * //     type: Card
 * //     ...
 * ```
 */
export function encodeSpecToToon(spec: Spec): string {
  return encode(spec);
}

/**
 * Decode a TOON string back into a Spec object.
 *
 * Used for:
 * - Parsing model output that produces a complete spec in TOON format
 * - Round-trip testing
 *
 * @example
 * ```ts
 * const toon = "root: main\nelements:\n  main:\n    type: Card\n    ...";
 * const spec = decodeSpecFromToon(toon);
 * ```
 */
export function decodeSpecFromToon(toon: string): Spec {
  const result = decode(toon) as unknown as Spec;
  // Ensure the required fields exist
  if (!result.root) result.root = "";
  if (!result.elements) result.elements = {};
  return result;
}

/**
 * Encode an array of JSON Patch operations to TOON format.
 *
 * Each patch becomes an object in the TOON array, which TOON will
 * render in tabular format when patches share the same fields.
 *
 * @example
 * ```ts
 * const patches = [
 *   { op: "add", path: "/root", value: "main" },
 *   { op: "add", path: "/elements/main", value: { type: "Card", ... } },
 * ];
 * const toon = encodePatchesToToon(patches);
 * ```
 */
export function encodePatchesToToon(patches: JsonPatch[]): string {
  return encode(patches);
}

/**
 * Encode arbitrary state data to TOON format.
 *
 * Particularly efficient for arrays of uniform objects (e.g. rows of data),
 * which TOON encodes in tabular format with field names declared once.
 *
 * @example
 * ```ts
 * const state = { items: [{ id: 1, name: "First" }, { id: 2, name: "Second" }] };
 * const toon = encodeStateToToon(state);
 * // items[2]{id,name}:
 * //   1,First
 * //   2,Second
 * ```
 */
export function encodeStateToToon(state: Record<string, unknown>): string {
  return encode(state);
}

// =============================================================================
// Streaming — Incremental TOON-to-Spec compilation
// =============================================================================

/**
 * Streaming TOON compiler interface.
 *
 * Analogous to `SpecStreamCompiler` but accepts TOON-formatted text
 * instead of JSONL patches. The compiler buffers incoming chunks and
 * attempts to decode after each complete line.
 */
export interface ToonStreamCompiler<T> {
  /** Push a chunk of TOON text. Returns the current result and whether it changed. */
  push(chunk: string): { result: T; changed: boolean };
  /** Get the current compiled result (flushes any remaining buffer) */
  getResult(): T;
  /** Reset the compiler to initial state */
  reset(initial?: Partial<T>): void;
}

/**
 * Create a streaming TOON compiler.
 *
 * Buffers incoming text chunks and attempts to decode the accumulated
 * TOON after each complete line. On successful decode, updates the result.
 * Handles partial TOON gracefully — `decode()` returns whatever top-level
 * fields are complete.
 *
 * @example
 * ```ts
 * const compiler = createToonStreamCompiler<Spec>();
 *
 * // Process streaming response line by line
 * const { result, changed } = compiler.push("root: main\n");
 * // result = { root: "main" }
 *
 * compiler.push("elements:\n  main:\n    type: Card\n");
 * // result progressively fills in
 *
 * const final = compiler.getResult();
 * ```
 */
export function createToonStreamCompiler<T = Record<string, unknown>>(
  initial: Partial<T> = {},
): ToonStreamCompiler<T> {
  let result = { ...initial } as T;
  let buffer = "";
  let lastSuccessfulDecode = "";

  return {
    push(chunk: string): { result: T; changed: boolean } {
      buffer += chunk;

      // Only attempt decode when we have complete lines
      const lastNewline = buffer.lastIndexOf("\n");
      if (lastNewline === -1) {
        return { result, changed: false };
      }

      // Try to decode the buffer up to the last complete line
      const toDecode = buffer.slice(0, lastNewline + 1);
      if (toDecode === lastSuccessfulDecode) {
        return { result, changed: false };
      }

      try {
        const decoded = decode(toDecode) as T;
        // Merge decoded into result (keep initial fields as defaults)
        result = { ...initial, ...decoded } as T;
        lastSuccessfulDecode = toDecode;
        return { result: { ...result }, changed: true };
      } catch {
        // Decode failed — likely incomplete TOON. Keep buffering.
        return { result, changed: false };
      }
    },

    getResult(): T {
      // Try to decode the full buffer (including any trailing incomplete line)
      if (buffer.trim() && buffer !== lastSuccessfulDecode) {
        try {
          const decoded = decode(buffer) as T;
          result = { ...initial, ...decoded } as T;
          lastSuccessfulDecode = buffer;
        } catch {
          // Ignore decode errors on final flush
        }
      }
      return result;
    },

    reset(newInitial: Partial<T> = {}): void {
      result = { ...newInitial } as T;
      buffer = "";
      lastSuccessfulDecode = "";
    },
  };
}

// =============================================================================
// Mixed Stream Parser — Text + TOON (for chat + GenUI)
// =============================================================================

/**
 * Callbacks for the TOON-aware mixed stream parser.
 */
export interface ToonMixedStreamCallbacks {
  /** Called when a complete TOON block is decoded into a Spec */
  onSpec: (spec: Spec) => void;
  /** Called when a text (non-TOON) line is received */
  onText: (text: string) => void;
}

/**
 * A stateful parser for mixed streams that contain both text and TOON blocks.
 * Used in chat + GenUI scenarios where an LLM responds with conversational text
 * interleaved with TOON-formatted spec blocks wrapped in ` ```toon ` fences.
 */
export interface ToonMixedStreamParser {
  /** Push a chunk of streamed data. */
  push(chunk: string): void;
  /** Flush any remaining buffered content. Call when the stream ends. */
  flush(): void;
}

/**
 * Create a parser for mixed text + TOON streams.
 *
 * In chat + GenUI scenarios, an LLM streams a response that contains both
 * conversational text and TOON-formatted spec blocks. TOON blocks are
 * wrapped in ` ```toon ` / ` ``` ` fences. This parser:
 *
 * 1. Detects ` ```toon ` fence openings
 * 2. Buffers all lines inside the fence
 * 3. On fence close, decodes the TOON and emits via `onSpec`
 * 4. All other lines are forwarded via `onText`
 *
 * @example
 * ```ts
 * const parser = createToonMixedStreamParser({
 *   onText: (text) => appendToMessage(text),
 *   onSpec: (spec) => setSpec(spec),
 * });
 *
 * for await (const chunk of stream) {
 *   parser.push(chunk);
 * }
 * parser.flush();
 * ```
 */
export function createToonMixedStreamParser(
  callbacks: ToonMixedStreamCallbacks,
): ToonMixedStreamParser {
  let buffer = "";
  let inToonFence = false;
  let toonBuffer = "";

  function processLine(line: string): void {
    const trimmed = line.trim();

    // Fence detection
    if (!inToonFence && trimmed.startsWith("```toon")) {
      inToonFence = true;
      toonBuffer = "";
      return;
    }
    if (inToonFence && trimmed === "```") {
      inToonFence = false;
      // Decode the accumulated TOON block
      if (toonBuffer.trim()) {
        try {
          const spec = decodeSpecFromToon(toonBuffer);
          callbacks.onSpec(spec);
        } catch {
          // If decode fails, forward as text
          callbacks.onText(toonBuffer);
        }
      }
      toonBuffer = "";
      return;
    }

    if (inToonFence) {
      toonBuffer += line + "\n";
      return;
    }

    // Outside fence: forward as text
    if (!trimmed) return;
    callbacks.onText(line);
  }

  return {
    push(chunk: string): void {
      buffer += chunk;

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        processLine(line);
      }
    },

    flush(): void {
      if (buffer.trim()) {
        processLine(buffer);
      }
      buffer = "";

      // If we're still inside a fence when flushing, try to decode what we have
      if (inToonFence && toonBuffer.trim()) {
        try {
          const spec = decodeSpecFromToon(toonBuffer);
          callbacks.onSpec(spec);
        } catch {
          callbacks.onText(toonBuffer);
        }
        inToonFence = false;
        toonBuffer = "";
      }
    },
  };
}

// =============================================================================
// Spec-to-Patches Conversion Helper
// =============================================================================

/**
 * Convert a decoded Spec into an array of JSON Patch operations.
 *
 * This is useful when integrating TOON output with existing patch-based
 * infrastructure. The generated patches will, when applied to an empty object,
 * reconstruct the original spec.
 *
 * @example
 * ```ts
 * const spec = decodeSpecFromToon(toonString);
 * const patches = specToPatches(spec);
 * // patches = [
 * //   { op: "add", path: "/root", value: "main" },
 * //   { op: "add", path: "/elements/main", value: { ... } },
 * //   ...
 * // ]
 * ```
 */
export function specToPatches(spec: Spec): SpecStreamLine[] {
  const patches: SpecStreamLine[] = [];

  // Root
  if (spec.root) {
    patches.push({ op: "add", path: "/root", value: spec.root });
  }

  // Elements
  if (spec.elements) {
    for (const [key, element] of Object.entries(spec.elements)) {
      patches.push({ op: "add", path: `/elements/${key}`, value: element });
    }
  }

  // State
  if (spec.state) {
    for (const [key, value] of Object.entries(spec.state)) {
      patches.push({ op: "add", path: `/state/${key}`, value });
    }
  }

  return patches;
}

import { encode } from "@toon-format/toon";
import type { Spec } from "@json-render/core";

/**
 * Options for encoding a json-render spec to TOON format.
 */
export interface ToonEncodeOptions {
  /** Number of spaces per indentation level (default: 2) */
  indent?: number;
}

/**
 * Encode a json-render {@link Spec} as a TOON string.
 *
 * Produces a compact, human-readable representation that uses
 * 30-60% fewer tokens than the equivalent JSON — ideal for
 * embedding in LLM prompts and refinement requests.
 *
 * @example
 * ```ts
 * const spec: Spec = { root: "main", elements: { ... }, state: { ... } };
 * const toon = encodeSpec(spec);
 * // root: main
 * // elements:
 * //   main:
 * //     type: Card
 * //     ...
 * ```
 */
export function encodeSpec(spec: Spec, options?: ToonEncodeOptions): string {
  return encode(spec as unknown as Record<string, unknown>, {
    indent: options?.indent,
  });
}

/**
 * Encode any JSON-serializable value as TOON.
 *
 * Thin wrapper around `@toon-format/toon`'s `encode` that re-exports it
 * under the `@json-render/toon` namespace for convenience.
 */
export function encodeToon(
  value: unknown,
  options?: ToonEncodeOptions,
): string {
  return encode(value as Record<string, unknown>, {
    indent: options?.indent,
  });
}

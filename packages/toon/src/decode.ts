import { decode } from "@toon-format/toon";
import type { Spec } from "@json-render/core";

/**
 * Options for decoding TOON back into JSON values.
 */
export interface ToonDecodeOptions {
  /**
   * When `true`, the decoder validates array counts, indentation depth,
   * and escape sequences. Useful for detecting truncated LLM output.
   * Defaults to `false`.
   */
  strict?: boolean;
}

/**
 * Decode a TOON string into a json-render {@link Spec}.
 *
 * @throws {Error} If the input is not valid TOON or does not
 * represent a valid Spec structure.
 *
 * @example
 * ```ts
 * const toon = `root: main
 * elements:
 *   main:
 *     type: Card
 *     props:
 *       title: Hello
 *     children[0]:`;
 * const spec = decodeSpec(toon);
 * // { root: "main", elements: { main: { type: "Card", ... } } }
 * ```
 */
export function decodeSpec(input: string, options?: ToonDecodeOptions): Spec {
  const raw = decode(input, { strict: options?.strict }) as Record<
    string,
    unknown
  >;

  if (typeof raw.root !== "string") {
    throw new Error("Decoded TOON does not contain a valid spec: missing root");
  }

  if (!raw.elements || typeof raw.elements !== "object") {
    throw new Error(
      "Decoded TOON does not contain a valid spec: missing elements",
    );
  }

  return raw as unknown as Spec;
}

/**
 * Decode any TOON string back to its JSON value.
 *
 * Thin wrapper around `@toon-format/toon`'s `decode` that re-exports it
 * under the `@json-render/toon` namespace for convenience.
 */
export function decodeToon(
  input: string,
  options?: ToonDecodeOptions,
): unknown {
  return decode(input, { strict: options?.strict });
}

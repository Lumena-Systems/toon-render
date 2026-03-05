import { encode } from "@toon-format/toon";
import type { Spec } from "@json-render/core";

/**
 * Options for building a TOON-encoded user prompt.
 */
export interface ToonUserPromptOptions {
  /** The user's text prompt */
  prompt: string;
  /** Existing spec to refine (triggers patch-only mode) */
  currentSpec?: Spec | null;
  /** Runtime state context to include */
  state?: Record<string, unknown> | null;
  /** Maximum length for the user's text prompt (applied before wrapping) */
  maxPromptLength?: number;
  /**
   * When `true`, instruct the LLM to respond with a full TOON spec
   * instead of JSONL patches.
   * Defaults to `false`.
   */
  toonOutput?: boolean;
}

/**
 * Build a user prompt that encodes the current spec and state in TOON format.
 *
 * Drop-in replacement for `buildUserPrompt` from `@json-render/core` that
 * encodes `currentSpec` and `state` as TOON instead of JSON, saving
 * 30-60% of input tokens on refinement requests.
 *
 * @example
 * ```ts
 * import { buildToonUserPrompt } from "@json-render/toon";
 *
 * // Refinement — spec is TOON-encoded, saving tokens
 * const prompt = buildToonUserPrompt({
 *   prompt: "add a dark mode toggle",
 *   currentSpec: spec,
 * });
 * ```
 */
export function buildToonUserPrompt(options: ToonUserPromptOptions): string {
  const { prompt, currentSpec, state, maxPromptLength, toonOutput } = options;

  let userText = String(prompt || "");
  if (maxPromptLength !== undefined && maxPromptLength > 0) {
    userText = userText.slice(0, maxPromptLength);
  }

  if (isNonEmptySpec(currentSpec)) {
    const parts: string[] = [];

    parts.push(
      "CURRENT UI STATE (already loaded, DO NOT recreate existing elements):",
    );
    parts.push(encode(currentSpec as unknown as Record<string, unknown>));
    parts.push("");
    parts.push(`USER REQUEST: ${userText}`);

    if (state && Object.keys(state).length > 0) {
      parts.push("");
      parts.push("AVAILABLE STATE:");
      parts.push(encode(state));
    }

    parts.push("");
    if (toonOutput) {
      parts.push(TOON_PATCH_INSTRUCTIONS);
    } else {
      parts.push(JSONL_PATCH_INSTRUCTIONS);
    }

    return parts.join("\n");
  }

  const parts: string[] = [userText];

  if (state && Object.keys(state).length > 0) {
    parts.push("\nAVAILABLE STATE:");
    parts.push(encode(state));
  }

  if (toonOutput) {
    parts.push(
      "\nOutput the full spec in TOON format (indentation-based, key: value pairs, no JSON braces).",
    );
  } else {
    parts.push(
      "\nRemember: Output /root first, then interleave /elements and /state patches so the UI fills in progressively as it streams. Output each state patch right after the elements that use it, one per array item.",
    );
  }

  return parts.join("\n");
}

const JSONL_PATCH_INSTRUCTIONS = `IMPORTANT: The current UI is already loaded. Output ONLY the patches needed to make the requested change:
- To add a new element: {"op":"add","path":"/elements/new-key","value":{...}}
- To modify an existing element: {"op":"replace","path":"/elements/existing-key","value":{...}}
- To remove an element: {"op":"remove","path":"/elements/old-key"}
- To update the root: {"op":"replace","path":"/root","value":"new-root-key"}
- To add children: update the parent element with new children array

DO NOT output patches for elements that don't need to change. Only output what's necessary for the requested modification.`;

const TOON_PATCH_INSTRUCTIONS = `IMPORTANT: The current UI is already loaded. Output ONLY the complete updated spec in TOON format with the requested changes applied.
Include all elements (both changed and unchanged) in the output since this replaces the full spec.`;

function isNonEmptySpec(spec: unknown): spec is Spec {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as Record<string, unknown>;
  return (
    typeof s.root === "string" &&
    typeof s.elements === "object" &&
    s.elements !== null &&
    Object.keys(s.elements as object).length > 0
  );
}

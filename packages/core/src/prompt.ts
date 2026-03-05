import type { Spec } from "./types";
import { encodeSpecToToon, encodeStateToToon } from "./toon";

/**
 * Options for building a user prompt.
 */
export interface UserPromptOptions {
  /** The user's text prompt */
  prompt: string;
  /** Existing spec to refine (triggers patch-only mode) */
  currentSpec?: Spec | null;
  /** Runtime state context to include */
  state?: Record<string, unknown> | null;
  /** Maximum length for the user's text prompt (applied before wrapping) */
  maxPromptLength?: number;
}

/**
 * Check whether a spec is non-empty (has a root and at least one element).
 */
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

const PATCH_INSTRUCTIONS = `IMPORTANT: The current UI is already loaded. Output the FULL updated spec in TOON format with ONLY the changes applied.
- To add a new element: include it in the elements map
- To modify an existing element: include the updated version
- To remove an element: omit it from the output
- You may output just the changed sections, or the full spec with changes applied.

Only include elements that are changing or being added. You may omit unchanged elements for brevity.`;

/**
 * Build a user prompt for AI generation.
 *
 * Handles common patterns that every consuming app needs:
 * - Truncating the user's prompt to a max length
 * - Including the current spec for refinement (patch-only mode)
 * - Including runtime state context
 *
 * @example
 * ```ts
 * // Fresh generation
 * buildUserPrompt({ prompt: "create a todo app" })
 *
 * // Refinement with existing spec
 * buildUserPrompt({ prompt: "add a dark mode toggle", currentSpec: spec })
 *
 * // With state context
 * buildUserPrompt({ prompt: "show my data", state: { todos: [] } })
 * ```
 */
export function buildUserPrompt(options: UserPromptOptions): string {
  const { prompt, currentSpec, state, maxPromptLength } = options;

  // Sanitize and optionally truncate the user's text
  let userText = String(prompt || "");
  if (maxPromptLength !== undefined && maxPromptLength > 0) {
    userText = userText.slice(0, maxPromptLength);
  }

  // --- Refinement mode: currentSpec is provided ---
  if (isNonEmptySpec(currentSpec)) {
    const parts: string[] = [];

    parts.push(
      `CURRENT UI STATE (already loaded, DO NOT recreate existing elements):`,
    );
    parts.push(encodeSpecToToon(currentSpec as Spec));
    parts.push("");
    parts.push(`USER REQUEST: ${userText}`);

    // Append state context if provided
    if (state && Object.keys(state).length > 0) {
      parts.push("");
      parts.push(`AVAILABLE STATE:\n${encodeStateToToon(state)}`);
    }

    parts.push("");
    parts.push(PATCH_INSTRUCTIONS);

    return parts.join("\n");
  }

  // --- Fresh generation mode ---
  const parts: string[] = [userText];

  if (state && Object.keys(state).length > 0) {
    parts.push(`\nAVAILABLE STATE:\n${encodeStateToToon(state)}`);
  }

  parts.push(
    `\nRemember: Output the complete spec in TOON format with root, elements, and state sections. The UI renders progressively as the TOON streams in.`,
  );

  return parts.join("\n");
}

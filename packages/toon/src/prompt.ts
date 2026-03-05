import { encode } from "@toon-format/toon";
import type {
  Catalog,
  PromptOptions,
  SchemaDefinition,
} from "@json-render/core";

/**
 * Extended prompt options for TOON-mode generation.
 */
export interface ToonPromptOptions extends PromptOptions {
  /**
   * When `true`, the prompt instructs the LLM to output a complete spec in
   * TOON format instead of JSONL patches.
   *
   * - Saves ~40% tokens on output compared to JSON.
   * - The response must be decoded with {@link decodeSpec} after streaming completes.
   * - For progressive UI updates during streaming, prefer the default
   *   JSONL patch mode and use {@link buildToonUserPrompt} for input savings only.
   *
   * Defaults to `false` (JSONL patches).
   */
  toonOutput?: boolean;
}

/**
 * Generate a system prompt for AI generation that uses TOON encoding
 * for examples and component definitions, reducing input token usage.
 *
 * This is a drop-in replacement for `catalog.prompt()` that encodes
 * bulky JSON examples as TOON, saving 30-60% input tokens while
 * preserving the same prompt semantics.
 *
 * When `toonOutput` is `true`, the prompt instructs the LLM to respond
 * in TOON format rather than JSONL patches.
 *
 * @example
 * ```ts
 * import { toonPrompt } from "@json-render/toon";
 *
 * const systemPrompt = toonPrompt(catalog, { mode: "generate" });
 * ```
 */
export function toonPrompt<TDef extends SchemaDefinition, TCatalog>(
  catalog: Catalog<TDef, TCatalog>,
  options: ToonPromptOptions = {},
): string {
  const {
    system = "You are a UI generator.",
    customRules = [],
    mode = "generate",
    toonOutput = false,
  } = options;

  const lines: string[] = [];
  lines.push(system);
  lines.push("");

  if (toonOutput) {
    buildToonOutputPrompt(lines, catalog, mode, customRules);
  } else {
    buildJsonlOutputPromptWithToonExamples(lines, catalog, mode, customRules);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Mode 1 – JSONL output (default) with TOON-encoded examples in the prompt
// ---------------------------------------------------------------------------

function buildJsonlOutputPromptWithToonExamples<
  TDef extends SchemaDefinition,
  TCatalog,
>(
  lines: string[],
  catalog: Catalog<TDef, TCatalog>,
  mode: "generate" | "chat",
  customRules: string[],
): void {
  if (mode === "chat") {
    lines.push("OUTPUT FORMAT (text + JSONL, RFC 6902 JSON Patch):");
    lines.push(
      "You respond conversationally. When generating UI, first write a brief explanation (1-3 sentences), then output JSONL patch lines wrapped in a ```spec code fence.",
    );
    lines.push("  ```spec");
    lines.push('  {"op":"add","path":"/root","value":"main"}');
    lines.push(
      '  {"op":"add","path":"/elements/main","value":{"type":"Card","props":{"title":"Hello"},"children":[]}}',
    );
    lines.push("  ```");
    lines.push(
      "If the user's message does not require a UI, respond with text only.",
    );
  } else {
    lines.push("OUTPUT FORMAT (JSONL, RFC 6902 JSON Patch):");
    lines.push(
      "Output JSONL (one JSON object per line) using RFC 6902 JSON Patch operations to build a UI tree.",
    );
  }

  lines.push(
    "Each line is a JSON patch operation (add, remove, replace). Start with /root, then stream /elements and /state patches interleaved so the UI fills in progressively.",
  );
  lines.push("");

  appendComponentsAndRules(lines, catalog, mode, customRules, false);
}

// ---------------------------------------------------------------------------
// Mode 2 – Full TOON output
// ---------------------------------------------------------------------------

function buildToonOutputPrompt<TDef extends SchemaDefinition, TCatalog>(
  lines: string[],
  catalog: Catalog<TDef, TCatalog>,
  mode: "generate" | "chat",
  customRules: string[],
): void {
  lines.push("OUTPUT FORMAT (TOON — Token-Oriented Object Notation):");
  lines.push(
    "Output the complete UI spec in TOON format. TOON is a compact, indentation-based encoding of JSON:",
  );
  lines.push(
    "- Objects use key: value on separate lines, nested via indentation",
  );
  lines.push("- Primitive arrays: key[N]: val1,val2,val3");
  lines.push("- Strings are unquoted unless they contain special characters");
  lines.push("- Empty arrays: key[0]:");
  lines.push("");

  const catalogData = catalog.data as Record<string, unknown>;
  const components = catalogData.components as
    | Record<string, ComponentDef>
    | undefined;
  const cn = catalog.componentNames;
  const comp1 = cn[0] || "Component";
  const comp2 = cn.length > 1 ? cn[1]! : comp1;
  const comp1Props = components?.[comp1]
    ? getExampleProps(components[comp1]!)
    : {};
  const comp2Props = components?.[comp2]
    ? getExampleProps(components[comp2]!)
    : {};

  const exampleSpec = {
    root: "main",
    elements: {
      main: {
        type: comp1,
        props: comp1Props,
        children: ["child-1"],
      },
      "child-1": {
        type: comp2,
        props: comp2Props,
        children: [],
      },
    },
    state: { count: 0 },
  };

  lines.push("Example TOON output:");
  lines.push("");
  lines.push(encode(exampleSpec));
  lines.push("");

  if (mode === "chat") {
    lines.push(
      "When generating UI, first write a brief explanation, then output the TOON spec in a ```toon code fence.",
    );
    lines.push(
      "If the user's message does not require a UI, respond with text only.",
    );
    lines.push("");
  }

  appendComponentsAndRules(lines, catalog, mode, customRules, true);
}

// ---------------------------------------------------------------------------
// Shared: components list + rules
// ---------------------------------------------------------------------------

interface ComponentDef {
  props?: { _def?: unknown };
  description?: string;
  slots?: string[];
  events?: string[];
  example?: Record<string, unknown>;
}

function appendComponentsAndRules<TDef extends SchemaDefinition, TCatalog>(
  lines: string[],
  catalog: Catalog<TDef, TCatalog>,
  mode: "generate" | "chat",
  customRules: string[],
  toonOutput: boolean,
): void {
  const catalogData = catalog.data as Record<string, unknown>;
  const components = catalogData.components as
    | Record<string, ComponentDef>
    | undefined;

  if (components) {
    lines.push(`AVAILABLE COMPONENTS (${catalog.componentNames.length}):`);
    lines.push("");

    for (const [name, def] of Object.entries(components)) {
      const hasChildren = def.slots && def.slots.length > 0;
      const childrenStr = hasChildren ? " [accepts children]" : "";
      const eventsStr =
        def.events && def.events.length > 0
          ? ` [events: ${def.events.join(", ")}]`
          : "";
      const descStr = def.description ? ` - ${def.description}` : "";
      const propsStr = def.example ? encode(def.example) : "{}";
      lines.push(`- ${name}: ${propsStr}${descStr}${childrenStr}${eventsStr}`);
    }
    lines.push("");
  }

  const actions = catalogData.actions as
    | Record<string, { params?: unknown; description?: string }>
    | undefined;
  const builtInActions = catalog.schema.builtInActions ?? [];
  const hasCustomActions = actions && catalog.actionNames.length > 0;
  const hasBuiltInActions = builtInActions.length > 0;

  if (hasCustomActions || hasBuiltInActions) {
    lines.push("AVAILABLE ACTIONS:");
    lines.push("");
    for (const action of builtInActions) {
      lines.push(`- ${action.name}: ${action.description} [built-in]`);
    }
    if (hasCustomActions) {
      for (const [name, def] of Object.entries(actions)) {
        lines.push(`- ${name}${def.description ? `: ${def.description}` : ""}`);
      }
    }
    lines.push("");
  }

  lines.push("SPEC STRUCTURE:");
  lines.push(
    "A spec contains: root (string key), elements (map of UI elements), and optional state (initial data).",
  );
  lines.push(
    "Each element has: type (component name), props (component properties), children (array of child element keys).",
  );
  lines.push(
    "Elements can optionally have: visible (condition), on (event bindings), repeat (dynamic list), watch (state watchers).",
  );
  lines.push("");
  lines.push("DYNAMIC PROPS:");
  lines.push(
    '- Read-only state: { "$state": "/path" } — reads from state model',
  );
  lines.push(
    '- Two-way binding: { "$bindState": "/path" } — reads and writes back',
  );
  lines.push(
    '- In repeat scopes: { "$item": "field" } — reads from current item, { "$bindItem": "field" } — two-way item binding',
  );
  lines.push(
    '- Conditional: { "$cond": <condition>, "$then": <val>, "$else": <val> }',
  );
  lines.push(
    '- Template: { "$template": "Hello, ${/name}!" } — string interpolation from state',
  );
  lines.push("");
  lines.push("VISIBILITY CONDITIONS:");
  lines.push(
    '- { "$state": "/path" } — visible when truthy, add "not": true to invert',
  );
  lines.push(
    '- { "$state": "/path", "eq": "value" } — visible when equal (also: neq, gt, gte, lt, lte)',
  );
  lines.push(
    '- [cond, cond] or { "$and": [...] } — all must be true; { "$or": [...] } — any must be true',
  );
  lines.push("");
  lines.push("DYNAMIC LISTS (repeat):");
  lines.push(
    '- Add "repeat": { "statePath": "/arrayPath", "key": "id" } to an element to render children per array item',
  );
  lines.push(
    "- The element itself is the container; children are expanded for each item",
  );
  lines.push("");
  lines.push("EVENTS (on field):");
  lines.push(
    '- "on": { "press": { "action": "setState", "params": { "statePath": "/key", "value": true } } }',
  );
  lines.push("- pushState: append to arrays. removeState: remove by index.");
  lines.push("");

  lines.push("RULES:");
  const outputFormatRule = toonOutput
    ? "Output the spec in TOON format — indentation-based, no braces, unquoted strings"
    : mode === "chat"
      ? "When generating UI, wrap all JSONL patches in a ```spec code fence"
      : "Output ONLY JSONL patches — one JSON object per line, no markdown, no code fences";

  const baseRules = [
    outputFormatRule,
    "ONLY use components listed above",
    "Each element needs: type, props, children (array of child keys)",
    "Use unique keys for element map entries (e.g., 'header', 'metric-1', 'chart-revenue')",
    "Include state data whenever using $state, $bindState, $item, $index, or repeat",
    "Include realistic sample data in state — never leave arrays empty",
    "State paths use RFC 6901 JSON Pointer syntax (e.g. /todos/0/title)",
  ];
  const schemaRules = catalog.schema.defaultRules ?? [];
  const allRules = [...baseRules, ...schemaRules, ...customRules];
  allRules.forEach((rule, i) => {
    lines.push(`${i + 1}. ${rule}`);
  });
}

function getExampleProps(def: ComponentDef): Record<string, unknown> {
  if (def.example && Object.keys(def.example).length > 0) {
    return def.example;
  }
  return {};
}

# @json-render/toon

TOON (Token-Oriented Object Notation) format support for [json-render](https://github.com/vercel-labs/json-render). Encode specs and prompts in TOON for **30-60% fewer LLM tokens** with no visible quality degradation.

## Installation

```bash
pnpm add @json-render/toon
```

## What is TOON?

TOON is a compact, human-readable data serialization format that encodes the same JSON data model using indentation instead of braces, minimizing quoting and declaring array lengths upfront. It achieves ~40% token savings compared to JSON while maintaining lossless round-trips.

**JSON (42 tokens):**
```json
{
  "root": "main",
  "elements": {
    "main": {
      "type": "Card",
      "props": { "title": "Hello" },
      "children": ["child-1"]
    }
  }
}
```

**TOON (25 tokens):**
```
root: main
elements:
  main:
    type: Card
    props:
      title: Hello
    children[1]: child-1
```

## Usage

### Encode specs for prompts (save input tokens)

```ts
import { encodeSpec, buildToonUserPrompt } from "@json-render/toon";

// Encode a spec as TOON
const toon = encodeSpec(spec);

// Build a TOON-encoded user prompt for refinement
const userPrompt = buildToonUserPrompt({
  prompt: "add a dark mode toggle",
  currentSpec: spec,
});
```

### TOON-optimized system prompts

```ts
import { toonPrompt } from "@json-render/toon";

// Drop-in replacement for catalog.prompt() with TOON-encoded examples
const systemPrompt = toonPrompt(catalog, { mode: "generate" });

// Or instruct the LLM to output in TOON format
const systemPrompt = toonPrompt(catalog, {
  mode: "generate",
  toonOutput: true,
});
```

### Decode TOON specs from LLM output

```ts
import { decodeSpec } from "@json-render/toon";

const spec = decodeSpec(llmOutput);
// { root: "main", elements: { ... }, state: { ... } }
```

### Streaming TOON output

```ts
import { createToonStreamCompiler } from "@json-render/toon";

const compiler = createToonStreamCompiler();

for await (const chunk of stream) {
  const { result, updated } = compiler.push(chunk);
  if (updated && result) {
    setSpec(result);
  }
}
```

### AI SDK integration

```ts
import { createToonTransform, pipeToonRender } from "@json-render/toon";

// Option 1: Use the transform directly
const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    writer.merge(
      result.toUIMessageStream().pipeThrough(createToonTransform()),
    );
  },
});

// Option 2: Use the convenience wrapper
const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    writer.merge(pipeToonRender(result.toUIMessageStream()));
  },
});
```

## API

### Encoding

- **`encodeSpec(spec, options?)`** - Encode a json-render Spec as TOON
- **`encodeToon(value, options?)`** - Encode any JSON value as TOON

### Decoding

- **`decodeSpec(input, options?)`** - Decode TOON back to a Spec
- **`decodeToon(input, options?)`** - Decode any TOON string to JSON

### Prompts

- **`toonPrompt(catalog, options?)`** - Generate a TOON-optimized system prompt
- **`buildToonUserPrompt(options)`** - Build a TOON-encoded user prompt

### Streaming

- **`createToonStreamCompiler()`** - Streaming TOON compiler
- **`createToonTransform()`** - AI SDK stream transform for TOON fences
- **`pipeToonRender(stream)`** - Convenience wrapper for stream piping

## License

Apache-2.0

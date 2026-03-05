import { describe, it, expect } from "vitest";
import {
  encodeSpecToToon,
  decodeSpecFromToon,
  encodePatchesToToon,
  encodeStateToToon,
  createToonStreamCompiler,
  createToonMixedStreamParser,
  specToPatches,
} from "./toon";
import type { Spec } from "./types";

// =============================================================================
// encodeSpecToToon / decodeSpecFromToon
// =============================================================================

describe("encodeSpecToToon", () => {
  it("encodes a simple spec to TOON format", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: {
          type: "Card",
          props: { title: "Hello" },
          children: ["child-1"],
        },
        "child-1": {
          type: "Button",
          props: { label: "Click me" },
          children: [],
        },
      },
    };
    const toon = encodeSpecToToon(spec);
    expect(toon).toContain("root: main");
    expect(toon).toContain("type: Card");
    expect(toon).toContain("type: Button");
    expect(toon).toContain("title: Hello");
    expect(toon).toContain("label: Click me");
    // Should NOT contain JSON braces
    expect(toon).not.toContain('{"op"');
  });

  it("encodes spec with state data", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: { type: "List", props: {}, children: [] },
      },
      state: {
        items: [
          { id: "1", title: "First" },
          { id: "2", title: "Second" },
        ],
        count: 0,
      },
    };
    const toon = encodeSpecToToon(spec);
    // Tabular array format for uniform objects
    expect(toon).toContain("items[2]{id,title}:");
    expect(toon).toContain("count: 0");
  });

  it("encodes spec with dynamic expressions", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: {
          type: "Text",
          props: { content: { $state: "/title" } },
          children: [],
          visible: { $state: "/showCard", eq: "yes" },
        },
      },
    };
    const toon = encodeSpecToToon(spec);
    expect(toon).toContain("$state");
    expect(toon).toContain("/title");
  });
});

describe("decodeSpecFromToon", () => {
  it("decodes a simple TOON spec", () => {
    const toon = `root: main
elements:
  main:
    type: Card
    props:
      title: Hello
    children[1]: child-1
  "child-1":
    type: Button
    props:
      label: Click me
    children[0]:`;

    const spec = decodeSpecFromToon(toon);
    expect(spec.root).toBe("main");
    expect(spec.elements.main).toBeDefined();
    expect(spec.elements.main!.type).toBe("Card");
    expect(spec.elements.main!.props).toEqual({ title: "Hello" });
    expect(spec.elements.main!.children).toEqual(["child-1"]);
    expect(spec.elements["child-1"]).toBeDefined();
    expect(spec.elements["child-1"]!.type).toBe("Button");
  });

  it("decodes spec with state data", () => {
    const toon = `root: main
elements:
  main:
    type: List
    props: {}
    children[0]:
state:
  items[2]{id,title}:
    "1",First
    "2",Second
  count: 0`;

    const spec = decodeSpecFromToon(toon);
    expect(spec.state).toBeDefined();
    expect(spec.state!.items).toEqual([
      { id: "1", title: "First" },
      { id: "2", title: "Second" },
    ]);
    expect(spec.state!.count).toBe(0);
  });

  it("handles empty spec gracefully", () => {
    const spec = decodeSpecFromToon("");
    expect(spec.root).toBe("");
    expect(spec.elements).toEqual({});
  });

  it("handles partial TOON (just root)", () => {
    const spec = decodeSpecFromToon("root: main");
    expect(spec.root).toBe("main");
    expect(spec.elements).toEqual({});
  });
});

describe("round-trip encode/decode", () => {
  it("round-trips a complex spec", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: {
          type: "Card",
          props: { title: "Dashboard" },
          children: ["metric-1", "list"],
        },
        "metric-1": {
          type: "Metric",
          props: { label: "Revenue", value: "$1.2M" },
          children: [],
        },
        list: {
          type: "Stack",
          props: { direction: "vertical" },
          children: ["item"],
          repeat: { statePath: "/items", key: "id" },
        },
        item: {
          type: "Text",
          props: { content: { $item: "title" } },
          children: [],
        },
      },
      state: {
        items: [
          { id: "1", title: "First" },
          { id: "2", title: "Second" },
        ],
        count: 2,
      },
    };

    const toon = encodeSpecToToon(spec);
    const decoded = decodeSpecFromToon(toon);

    expect(decoded.root).toBe(spec.root);
    expect(decoded.elements.main!.type).toBe("Card");
    expect(decoded.elements.main!.props).toEqual({ title: "Dashboard" });
    expect(decoded.elements.main!.children).toEqual(["metric-1", "list"]);
    expect(decoded.state!.items).toEqual(spec.state!.items);
    expect(decoded.state!.count).toBe(2);
  });

  it("round-trips visibility conditions", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: {
          type: "Container",
          props: {},
          children: [],
          visible: { $state: "/active", eq: "yes" },
        },
      },
    };

    const toon = encodeSpecToToon(spec);
    const decoded = decodeSpecFromToon(toon);
    expect(decoded.elements.main!.visible).toEqual({
      $state: "/active",
      eq: "yes",
    });
  });

  it("round-trips event bindings", () => {
    const spec: Spec = {
      root: "btn",
      elements: {
        btn: {
          type: "Button",
          props: { label: "Click" },
          children: [],
          on: {
            press: {
              action: "setState",
              params: { statePath: "/clicked", value: true },
            },
          },
        },
      },
    };

    const toon = encodeSpecToToon(spec);
    const decoded = decodeSpecFromToon(toon);
    expect(decoded.elements.btn!.on).toEqual({
      press: {
        action: "setState",
        params: { statePath: "/clicked", value: true },
      },
    });
  });
});

// =============================================================================
// encodePatchesToToon
// =============================================================================

describe("encodePatchesToToon", () => {
  it("encodes patches to TOON format", () => {
    const patches = [
      { op: "add" as const, path: "/root", value: "main" },
      {
        op: "add" as const,
        path: "/elements/main",
        value: { type: "Card", props: { title: "Hello" }, children: [] },
      },
    ];
    const toon = encodePatchesToToon(patches);
    expect(toon).toContain("op: add");
    expect(toon).toContain("path: /root");
  });
});

// =============================================================================
// encodeStateToToon
// =============================================================================

describe("encodeStateToToon", () => {
  it("encodes state with tabular arrays", () => {
    const state = {
      items: [
        { id: 1, name: "Widget A", price: 10 },
        { id: 2, name: "Widget B", price: 25 },
      ],
    };
    const toon = encodeStateToToon(state);
    // Tabular format: field names declared once
    expect(toon).toContain("items[2]{id,name,price}:");
    expect(toon).toContain("1,Widget A,10");
    expect(toon).toContain("2,Widget B,25");
  });

  it("encodes scalar state", () => {
    const state = { count: 42, name: "Alice", active: true };
    const toon = encodeStateToToon(state);
    expect(toon).toContain("count: 42");
    expect(toon).toContain("name: Alice");
    expect(toon).toContain("active: true");
  });
});

// =============================================================================
// createToonStreamCompiler
// =============================================================================

describe("createToonStreamCompiler", () => {
  it("progressively builds a spec from TOON chunks", () => {
    const compiler = createToonStreamCompiler<Spec>();

    // Push root line
    let { result, changed } = compiler.push("root: main\n");
    expect(changed).toBe(true);
    expect(result.root).toBe("main");

    // Push elements start
    ({ result, changed } = compiler.push("elements:\n"));
    // May or may not change — elements: creates empty object
    if (changed) {
      expect(result.elements).toBeDefined();
    }

    // Push a complete element
    ({ result, changed } = compiler.push(
      "  main:\n    type: Card\n    props:\n      title: Hello\n    children[0]:\n",
    ));
    expect(changed).toBe(true);
    expect(result.elements).toBeDefined();
    expect(result.elements!.main).toBeDefined();
    expect(result.elements!.main!.type).toBe("Card");
  });

  it("handles chunks split mid-line", () => {
    const compiler = createToonStreamCompiler<Spec>();

    // Push partial line — should not trigger decode
    let { changed } = compiler.push("root: ma");
    expect(changed).toBe(false);

    // Complete the line
    ({ changed } = compiler.push("in\n"));
    expect(changed).toBe(true);
    expect(compiler.getResult().root).toBe("main");
  });

  it("getResult flushes remaining buffer", () => {
    const compiler = createToonStreamCompiler<Spec>();

    compiler.push("root: main");
    // No newline yet, so push didn't decode

    const result = compiler.getResult();
    expect(result.root).toBe("main");
  });

  it("reset clears state", () => {
    const compiler = createToonStreamCompiler<Spec>();

    compiler.push("root: main\n");
    expect(compiler.getResult().root).toBe("main");

    compiler.reset();
    expect(compiler.getResult().root).toBeUndefined();
  });

  it("handles initial values", () => {
    const compiler = createToonStreamCompiler<Spec>({
      root: "default",
      elements: {},
    });

    expect(compiler.getResult().root).toBe("default");

    compiler.push("root: updated\n");
    expect(compiler.getResult().root).toBe("updated");
  });
});

// =============================================================================
// createToonMixedStreamParser
// =============================================================================

describe("createToonMixedStreamParser", () => {
  it("separates text from TOON fences", () => {
    const texts: string[] = [];
    const specs: Spec[] = [];

    const parser = createToonMixedStreamParser({
      onText: (text) => texts.push(text),
      onSpec: (spec) => specs.push(spec),
    });

    parser.push("Here is your dashboard:\n");
    parser.push("```toon\n");
    parser.push("root: main\n");
    parser.push("elements:\n");
    parser.push("  main:\n");
    parser.push("    type: Card\n");
    parser.push("    props:\n");
    parser.push("      title: Dashboard\n");
    parser.push("    children[0]:\n");
    parser.push("```\n");
    parser.push("Hope that helps!\n");
    parser.flush();

    expect(texts.length).toBeGreaterThanOrEqual(2);
    expect(texts[0]).toContain("Here is your dashboard:");
    expect(texts[texts.length - 1]).toContain("Hope that helps!");

    expect(specs).toHaveLength(1);
    expect(specs[0]!.root).toBe("main");
    expect(specs[0]!.elements.main!.type).toBe("Card");
  });

  it("handles text-only stream (no fences)", () => {
    const texts: string[] = [];
    const specs: Spec[] = [];

    const parser = createToonMixedStreamParser({
      onText: (text) => texts.push(text),
      onSpec: (spec) => specs.push(spec),
    });

    parser.push("Just a conversation.\n");
    parser.push("No UI needed.\n");
    parser.flush();

    expect(texts.length).toBe(2);
    expect(specs).toHaveLength(0);
  });

  it("handles TOON fence at end of stream without closing", () => {
    const texts: string[] = [];
    const specs: Spec[] = [];

    const parser = createToonMixedStreamParser({
      onText: (text) => texts.push(text),
      onSpec: (spec) => specs.push(spec),
    });

    parser.push("```toon\n");
    parser.push("root: main\n");
    parser.push("elements:\n");
    parser.push("  main:\n");
    parser.push("    type: Text\n");
    parser.push("    props:\n");
    parser.push("      content: Hello\n");
    parser.push("    children[0]:\n");
    // No closing fence — flush should still decode
    parser.flush();

    expect(specs).toHaveLength(1);
    expect(specs[0]!.root).toBe("main");
  });

  it("handles chunks that span fence boundaries", () => {
    const texts: string[] = [];
    const specs: Spec[] = [];

    const parser = createToonMixedStreamParser({
      onText: (text) => texts.push(text),
      onSpec: (spec) => specs.push(spec),
    });

    // All in one chunk
    parser.push(
      "Hello\n```toon\nroot: main\nelements:\n  main:\n    type: Card\n    props:\n      title: Hi\n    children[0]:\n```\nBye\n",
    );
    parser.flush();

    expect(specs).toHaveLength(1);
    expect(specs[0]!.root).toBe("main");
    expect(texts.some((t) => t.includes("Hello"))).toBe(true);
    expect(texts.some((t) => t.includes("Bye"))).toBe(true);
  });
});

// =============================================================================
// specToPatches
// =============================================================================

describe("specToPatches", () => {
  it("converts a spec to JSON Patch operations", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: { type: "Card", props: { title: "Hello" }, children: [] },
      },
      state: { count: 0 },
    };

    const patches = specToPatches(spec);
    expect(patches).toHaveLength(3); // root + 1 element + 1 state key

    expect(patches[0]).toEqual({
      op: "add",
      path: "/root",
      value: "main",
    });
    expect(patches[1]).toEqual({
      op: "add",
      path: "/elements/main",
      value: { type: "Card", props: { title: "Hello" }, children: [] },
    });
    expect(patches[2]).toEqual({
      op: "add",
      path: "/state/count",
      value: 0,
    });
  });

  it("handles spec without state", () => {
    const spec: Spec = {
      root: "main",
      elements: {
        main: { type: "Text", props: { content: "Hi" }, children: [] },
      },
    };

    const patches = specToPatches(spec);
    expect(patches).toHaveLength(2); // root + 1 element
  });

  it("handles empty spec", () => {
    const spec: Spec = { root: "", elements: {} };
    const patches = specToPatches(spec);
    expect(patches).toHaveLength(0); // empty root is falsy
  });
});

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createSpecStreamCompiler } from "@json-render/core";
import { Player, PlayerRef } from "@remotion/player";
import { Renderer, type TimelineSpec } from "@json-render/remotion";
import { createHighlighter, type Highlighter } from "shiki";

/**
 * Check if spec is complete enough to render
 */
function isSpecComplete(spec: TimelineSpec): spec is Required<TimelineSpec> {
  return !!(
    spec.composition &&
    spec.tracks &&
    Array.isArray(spec.clips) &&
    spec.clips.length > 0
  );
}

/**
 * Shiki theme (Vercel-inspired dark theme)
 */
const darkTheme = {
  name: "custom-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "transparent",
    "editor.foreground": "#EDEDED",
  },
  settings: [
    {
      scope: ["string", "string.quoted"],
      settings: { foreground: "#50E3C2" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language.boolean",
        "constant.language.null",
      ],
      settings: { foreground: "#50E3C2" },
    },
    {
      scope: ["punctuation", "meta.brace", "meta.bracket"],
      settings: { foreground: "#888888" },
    },
    {
      scope: ["support.type.property-name", "entity.name.tag.json"],
      settings: { foreground: "#EDEDED" },
    },
  ],
};

// Preload highlighter
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [darkTheme],
      langs: ["json"],
    });
  }
  return highlighterPromise;
}

// Start loading immediately
if (typeof window !== "undefined") {
  getHighlighter();
}

/**
 * Code block with syntax highlighting
 */
function CodeBlock({ code }: { code: string }) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    getHighlighter().then((highlighter) => {
      setHtml(
        highlighter.codeToHtml(code, {
          lang: "json",
          theme: "custom-dark",
        }),
      );
    });
  }, [code]);

  if (!html) {
    return (
      <pre className="p-4 text-left">
        <code className="text-muted-foreground">{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="p-4 text-[13px] leading-relaxed [&_pre]:bg-transparent! [&_pre]:p-0! [&_pre]:m-0! [&_code]:bg-transparent!"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Copy button component
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
      aria-label="Copy JSON"
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const EXAMPLE_PROMPTS = [
  "Create a 10-second product intro with title cards and images",
  "Make a photo slideshow with 5 different images",
  "Build a testimonial video with quotes and background images",
  "Design a dynamic company intro with animated entrances",
];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [spec, setSpec] = useState<TimelineSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<PlayerRef>(null);

  const generate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setSpec(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        throw new Error("Generation failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const compiler = createSpecStreamCompiler<TimelineSpec>({
        format: "toon",
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const { result, newPatches } = compiler.push(chunk);

        if (newPatches.length > 0) {
          setSpec(result);
        }
      }

      // Get final result (processes any remaining buffer)
      const finalSpec = compiler.getResult();
      setSpec(finalSpec);

      // Final validation and auto-play
      if (isSpecComplete(finalSpec)) {
        // Auto-play after a short delay to ensure Player is mounted
        setTimeout(() => {
          playerRef.current?.play();
        }, 100);
      } else {
        setError("Generated timeline is incomplete");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    generate();
  };

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleExport = useCallback(() => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "timeline.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [spec]);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="text-xs font-mono text-muted-foreground mb-4">
          @json-render/remotion
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tighter mb-6">
          AI &rarr; json-render &rarr; Video
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed">
          Define a video catalog. Users prompt. AI outputs timeline JSON
          constrained to your components. Remotion renders it.
        </p>

        {/* Demo */}
        <div className="max-w-4xl mx-auto">
          {/* Prompt Input */}
          <form onSubmit={handleSubmit} className="mb-4">
            <div className="border border-border rounded p-3 bg-background font-mono text-sm flex items-center gap-2">
              <span className="text-muted-foreground">&gt;</span>
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to create..."
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50"
                disabled={isGenerating}
                maxLength={500}
              />
              {isGenerating ? (
                <button
                  type="button"
                  onClick={() => setIsGenerating(false)}
                  className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="6" width="12" height="12" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-30"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          </form>

          {/* Example prompts */}
          <div className="flex flex-wrap gap-2 justify-center mb-6">
            {EXAMPLE_PROMPTS.map((examplePrompt) => (
              <button
                key={examplePrompt}
                onClick={() => handleExampleClick(examplePrompt)}
                className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
              >
                {examplePrompt}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
              {error}
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* JSON Panel */}
            <div className="text-left">
              <div className="flex items-center gap-4 mb-2 h-6">
                <span className="text-xs font-mono text-muted-foreground">
                  json
                </span>
                {isGenerating && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    generating...
                  </span>
                )}
              </div>
              <div className="border border-border rounded bg-background font-mono text-xs h-[28rem] overflow-auto relative group">
                {spec && (
                  <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={JSON.stringify(spec, null, 2)} />
                  </div>
                )}
                {spec ? (
                  <CodeBlock code={JSON.stringify(spec, null, 2)} />
                ) : isGenerating ? (
                  <div className="p-4 text-muted-foreground/50 h-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                      </div>
                      <span>Generating timeline...</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-muted-foreground/50 h-full flex items-center justify-center">
                    Enter a prompt to generate a video timeline
                  </div>
                )}
              </div>
            </div>

            {/* Video Preview Panel */}
            <div>
              <div className="flex items-center justify-between mb-2 h-6">
                <span className="text-xs font-mono text-muted-foreground">
                  preview
                </span>
                <div className="flex items-center gap-2">
                  {spec && isSpecComplete(spec) && (
                    <button
                      onClick={handleExport}
                      className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
                      title="Export timeline JSON"
                    >
                      Export
                    </button>
                  )}
                </div>
              </div>
              <div
                className="border border-border rounded bg-black h-[28rem] relative overflow-hidden"
                data-player-container
              >
                {spec && isSpecComplete(spec) ? (
                  <Player
                    ref={playerRef}
                    component={Renderer}
                    inputProps={{ spec }}
                    durationInFrames={spec.composition.durationInFrames}
                    fps={spec.composition.fps}
                    compositionWidth={spec.composition.width}
                    compositionHeight={spec.composition.height}
                    style={{
                      width: "100%",
                      height: "100%",
                    }}
                    controls
                    loop
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-white/30 text-sm">
                    {isGenerating ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" />
                          <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                          <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                        </div>
                        <span>Generating timeline...</span>
                      </div>
                    ) : spec ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" />
                          <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce [animation-delay:0.1s]" />
                          <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                        </div>
                        <span>Building timeline...</span>
                      </div>
                    ) : (
                      "Enter a prompt to generate a video"
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// Encoding
export { encodeSpec, encodeToon } from "./encode";
export type { ToonEncodeOptions } from "./encode";

// Decoding
export { decodeSpec, decodeToon } from "./decode";
export type { ToonDecodeOptions } from "./decode";

// Prompt generation (TOON-optimised)
export { toonPrompt } from "./prompt";
export type { ToonPromptOptions } from "./prompt";

// User prompt builder (TOON-encoded)
export { buildToonUserPrompt } from "./user-prompt";
export type { ToonUserPromptOptions } from "./user-prompt";

// Streaming
export {
  createToonStreamCompiler,
  createToonTransform,
  pipeToonRender,
} from "./stream";
export type { ToonStreamCompiler } from "./stream";

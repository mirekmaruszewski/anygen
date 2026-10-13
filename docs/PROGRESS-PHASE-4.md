# AnyGen – Progress: Phase 4 (Built-in nodes)

Status: 27 built-in nodes are implemented, including the three first-workflow nodes. `pnpm test` (121 tests), `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `nuxt typecheck` and `pnpm build` are clean. The first workflow (**Load Image → Quiz from Image → Save JSON**) was run end to end against the built server, with the real Anthropic provider code talking to a fake Messages API (no real API key was used).

Not done: **Loop/Batch** and **Upscale** (see "Deferred"). The video node and the fal/Replicate/Ollama nodes were never run against a live service. The quiz runner's JSON format is still unknown.

## Versions (pinned in `packages/nodes`)

`ai@7.0.137`, `@ai-sdk/anthropic@4.0.78`, `@ai-sdk/openai@4.0.91`, `@ai-sdk/replicate@3.0.59`, `@ai-sdk/fal@3.0.59`, `ollama-ai-provider-v2@4.0.1`, `quickjs-emscripten@0.32.0`.

AI SDK v7 facts checked against the docs bundled in `node_modules/ai/docs`:

- Structured output is `generateText` + `Output.object({ schema })` (the old `generateObject` is gone from the docs). Anthropic receives it as native `output_config.format = json_schema`.
- `generateImage`, `experimental_generateSpeech`, `transcribe` and `experimental_generateVideo` are the media APIs. **Video now exists in the SDK** for fal and Replicate, so the plan's "call the clients directly" is not needed.
- The `image` message part is deprecated; images are sent as `file` parts.

## Nodes

| Category | Nodes                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| Input    | Text, Number, Seed (fixed/random), Load Image, Load Audio, Load Video                      |
| Utility  | Concat, Prompt Template (`{{vars}}`), Switch                                               |
| LLM      | Claude Chat, OpenAI Chat, Ollama Chat, Vision, Structured Output, Vision Structured Output |
| Quiz     | Quiz from Image                                                                            |
| Image    | OpenAI Image, Image (fal / Replicate), Image to Image                                      |
| Audio    | Text to Speech, Speech to Text                                                             |
| Video    | Video (text/image to video, async job)                                                     |
| Generic  | HTTP Request, Custom Code                                                                  |
| Output   | Preview, Save JSON, Save File                                                              |

Layout: `packages/nodes/src/{core,llm,quiz,image,audio,video,generic}`, shared code in `ai/` (`models.ts`, `text.ts`) and `util/assets.ts`.

## Design notes

- **Model ids** are `provider:model` strings in a plain `text` param (e.g. `anthropic:claude-sonnet-5-5`, `fal:fal-ai/flux/dev`, `ollama:llama3.2`). `ai/models.ts` builds a `createProviderRegistry` per node execution from the keys configured _right now_, so keys saved in Settings work without a restart. A missing key gives `Provider "openai" is not configured. Set OPENAI_API_KEY or add the key in Settings.` The Ollama URL comes from the `ollamaBaseUrl` setting (`/api` is appended if missing). **LM Studio** (and other OpenAI-compatible servers) use the `lmstudio:<model>` prefix via `@ai-sdk/openai-compatible@3.0.67`; the URL comes from the `lmstudioBaseUrl` setting (default `http://localhost:1234`, `/v1` appended if missing) and needs no key.
- **Test seam:** `services.modelResolver` overrides the resolver (used by tests; a host could use it too).
- **Streaming:** chat and vision nodes use `streamText` and forward the text so far as `progress({ partial })`, throttled to every 150 ms.
- **Structured output** (`runStructured`): the JSON Schema param is converted with `z.fromJSONSchema` so the result is really validated (falls back to an unvalidated `jsonSchema` for exotic schemas). On a schema or semantic-check failure the model gets one retry, with the error message appended.
- **Quiz from Image** uses a flat model-facing schema (no unions; options are strings and correct answers are indices) so every provider's structured mode handles it. `checkQuiz` then enforces: at most N questions, requested types, at least 2 distinct non-empty options, at least one correct option, indices in range, both types present when asked for both. `pageReadable: false` becomes a clear error. `buildQuiz` converts to the runner format (ids `q1…`, options `a, b, c…`). **The runner format is still the PLAN.md placeholder, so adapting it means changing only `buildQuiz` and the `Quiz` type in `quiz/quiz.ts`.**
- **Custom Code runs in QuickJS (WASM), not `node:vm`.** `node:vm` is not a security boundary and imported workflow JSON is untrusted input. The sandbox has no `process`, `require`, `fetch`, files or network; 64 MB memory limit, 1 MB stack, timeout (default 5 s, max 30 s) and cancellation through the interrupt handler. Values cross as JSON. Tests cover `this.constructor.constructor(...)` escapes, hostile input data, infinite loops and memory exhaustion. Caveat: execution is synchronous, so it blocks the server event loop until it finishes or times out.
- **HTTP Request:** http/https only, 50 MB response cap, timeout, never cached. JSON is parsed, text returned as text, binary stored as an asset. Requests originate from the AnyGen server, so they can reach anything the server can reach (same trust model as the rest of the unauthenticated localhost app).
- **Save JSON / Save File** store into the asset store and output a `file` (`any`-typed asset ref). The Inspector now previews any asset by MIME type (so `any`-typed ports like Preview work) and offers a **Download** link.
- **Asset params (core + UI):** new `asset` param type with an `accept` pattern. `AssetPicker.vue` (a Baklava custom interface) uploads to `POST /api/assets`, shows a thumbnail for images, and offers Replace/Clear. Verified in headless Edge. `graphConvert` round-trips asset refs (tested).
- **Caching:** AI nodes are cached like any other (identical inputs and params return the stored result, which saves money). Change a param or add a Seed node to force a new generation. Seed, HTTP Request are never cached.
- Core: `AnyGenServices.settings` (optional, read-only) was added so nodes can read `ollamaBaseUrl`; the server fills it in.

## Example workflow

`workflows/book-page-to-quiz.json` (validated by a test). Import it in the editor, pick a page image in Load Image, and set `ANTHROPIC_API_KEY` (or store it in Settings).

## Verification done

- Unit tests for each node group: utilities, quiz checks and node (including retry and unreadable page), chat/vision/structured output with a mock model, resolver errors, the sandbox, HTTP against a local server, and image/speech/transcription through the real OpenAI provider against a fake server.
- End-to-end on the built `.output` server: upload, run, SSE-free polling of `GET /api/runs/:id`, download of `quiz.json`, cache hit on re-run (0 extra provider calls), missing-key error with the dependent node skipped, and sandbox/timeout inside a real run. The captured Anthropic request had the image as a `file` part and the schema in `output_config`.
- The QuickJS WASM files are traced into `.output/server/node_modules`, and the sandbox worked from the built server.
- Browser: Load Image picker renders, uploads, shows a thumbnail, no console errors.

## Deferred / known gaps

- **Loop/Batch (list map):** needs engine support to run a subgraph per item; it cannot be a plain node. Best done with Phase 5's subgraphs.
- **Upscale:** no verified model/API mapping; fal lists `fal-ai/esrgan` and `clarity-upscaler` as image models, so it is probably a thin wrapper once tested with a real key.
- **Live checks missing:** real calls to Anthropic/OpenAI/fal/Replicate/Ollama, and especially video (async polling), were not run. Only OpenAI image/speech/transcription and Anthropic text were exercised, against fakes.
- **Model dropdown:** model params are free text. The plan's idea of listing models per configured provider needs a `GET /api/models` endpoint plus a select/datalist in the UI.
- Token usage is not yet surfaced (needed for Phase 6 cost estimates).
- New nodes land on top of each other when added from the palette (existing Phase 3 behavior).
- Generation nodes return a single item (`n: 1`); multi-image output would need `list<image>`.

## Next steps

1. Get the quiz runner JSON (or a sample) and adapt `buildQuiz`.
2. Try the first workflow with a real page scan and a real key; tune the prompt in `quizPrompt`.
3. Smoke-test fal/Replicate image and video with real keys.
4. Phase 5: plugin loader, declarative REST nodes, subgraphs (then Loop/Batch).

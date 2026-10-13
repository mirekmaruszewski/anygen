# AnyGen – Node-Based AI Generation App (ComfyUI-style): Plan

## Context

Build **AnyGen**, a visual, node-graph app for generating anything (text, images, audio, video, structured data, code) with AI models. Users drag nodes onto a canvas, connect typed outputs to inputs, and run the graph. The working directory (`c:\_PROJEKTY\2026\AnyGen`) is empty, so this is a greenfield project. Goal: a small, extensible core (graph engine + node plugin system) with model providers added as nodes.

## Key Decisions (defaults, easy to change)

| Area                   | Choice                                                                                                                                                                                                      | Why                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shape              | Local web app (browser UI + local server), optional Electron/Tauri wrapper later                                                                                                                            | Fastest path, Windows-friendly, API keys stay local                                                                                                 |
| Framework              | **Nuxt 3** (Vue 3 + Nitro server) + TypeScript, full-stack in one app                                                                                                                                       | Vue across the whole stack; one process, one `pnpm dev`, shared types                                                                               |
| Frontend               | Vue 3 SFCs in Nuxt (client-only editor page) + **BaklavaJS** (`@baklavajs/core`, `renderer-vue`, `interface-types`, `themes`) + Pinia                                                                       | BaklavaJS is a Vue 3 node editor: canvas, typed interfaces, minimap, sidebar, undo/redo, save/load built in. Editor must be `<ClientOnly>` (no SSR) |
| Backend                | Nuxt **Nitro server routes** (`server/api/*`) + WebSocket (Nitro `defineWebSocketHandler`) for progress                                                                                                     | No separate Fastify service; native TypeScript                                                                                                      |
| Graph engine           | Custom DAG executor on the **server** (`core` package); BaklavaJS is the editor only                                                                                                                        | Baklava's engine runs in the browser, but API keys must stay server-side; we also need caching, cancellation, parallel branches                     |
| Editor ↔ server bridge | Server serves a node catalog (JSON); web app turns each entry into a Baklava node via `defineNode`; `editor.save()` state is converted to AnyGen graph JSON for execution                                   | Single source of truth for node definitions; no node logic duplicated in the UI                                                                     |
| Storage                | SQLite (workflows, run history) + filesystem for generated assets                                                                                                                                           | Zero-setup, local                                                                                                                                   |
| Model access           | **Vercel AI SDK** (`ai` package) used only on the server, inside node `execute` functions                                                                                                                   | One API for text, vision, structured output, streaming, image, speech and transcription; swap providers by changing a model string                  |
| Providers (v1)         | `@ai-sdk/anthropic` (Claude), `@ai-sdk/openai` (text + image + speech), `@ai-sdk/replicate` / `@ai-sdk/fal` (image/video), Ollama community provider (local)                                                | Covers text, image, video, local models                                                                                                             |
| Model selection        | A shared provider registry (`createProviderRegistry`) in `packages/nodes`; nodes take a `model` param like `anthropic:claude-sonnet-5-5`; the catalog lists models per provider whose API key is configured | Users pick models from a dropdown; adding a provider is one registry entry                                                                          |
| Repo layout            | pnpm workspace: Nuxt app + framework-agnostic `core` and `nodes` packages                                                                                                                                   | Engine and nodes stay unit-testable without Nuxt and reusable from a CLI                                                                            |

## Core Concepts

- **Node definition** (plugin contract): `id`, `title`, `category`, `inputs[]`, `outputs[]`, `params[]` (UI widgets), `execute(ctx, inputs, params) -> outputs`.
- **Port types**: `text`, `number`, `boolean`, `image`, `audio`, `video`, `json`, `any`, `list<T>`. Edges only connect compatible types (with explicit converter nodes).
- **Graph**: `{ nodes: [{id, type, position, params}], edges: [{from: {node, port}, to: {node, port}}] }`, serialized as JSON (versioned schema).
- **Execution**: topological sort, run independent branches in parallel, per-node result cache keyed by hash(inputs + params) so unchanged nodes are skipped; cancel, error isolation (downstream of failed node skipped), streamed progress events.
- **Assets**: large binary outputs (images/audio/video) stored on disk and passed between nodes as asset references, not inline.

## Project Structure

```
AnyGen/
  package.json, pnpm-workspace.yaml, tsconfig.base.json
  packages/
    core/        # types, graph schema (zod), validation, executor, node registry
    nodes/       # built-in node definitions grouped by provider/category
  app/           # Nuxt 3 application
    pages/       # editor page, history, gallery, settings
    components/  # Baklava editor wrapper, inspector, media previews
    composables/ # useGraphRunner, useNodeCatalog
    stores/      # Pinia
    server/      # Nitro: api/*, websocket, db (SQLite), assets, secrets
  docs/PLAN.md
  workflows/     # example workflow JSON files
```

## First Target Workflow: Book Page → Quiz JSON

The first end-to-end flow the app must support (drives M1/M2 scope):

```
[Load Image]  →  [Vision Structured Output (Claude)]  →  [Save JSON]
 scan of page      image + instructions + JSON schema      quiz.json
```

- **Load Image**: file picker/upload, outputs an `image` asset reference (supports jpg/png/webp; optional multi-page list later).
- **Vision Structured Output**: built on the AI SDK. Sends the image (as an image part in a user message) to a vision-capable model with a prompt ("extract the key facts from this page and write N questions") and a Zod schema using structured output (`generateObject`, or `generateText` with `Output.object` depending on the installed AI SDK major version), so the output is validated against the schema. Streaming partial results to the preview panel can use `streamObject`/streamed output. Params: model, question count, language, difficulty, allowed question types, optional extra instructions. Outputs `json`.
- **Save JSON**: writes the result to the asset store / a chosen path and offers it as a download; also shown in the Preview panel.
- **Quiz format (proposed, to match the quiz runner)**:

```json
{
  "title": "string",
  "source": { "type": "image", "name": "page-12.jpg" },
  "language": "en",
  "questions": [
    { "id": "q1", "type": "open", "question": "…", "answer": "…", "acceptedAnswers": ["…"] },
    {
      "id": "q2",
      "type": "multiselect",
      "question": "…",
      "options": [
        { "id": "a", "text": "…" },
        { "id": "b", "text": "…" }
      ],
      "correct": ["a"],
      "explanation": "…"
    }
  ]
}
```

- **Open item**: the quiz runner's expected JSON format is not yet known. The schema above is a placeholder; adapt it once the runner's format is provided (the schema lives in the node's params, so it is a config change, not a code change). Consider a later quiz-runner page inside the app to play the generated file.
- **Quality checks**: validate the output against the schema (retry once on failure), ensure each multiselect has at least one correct option and that `correct` ids exist in `options`; warn when the page is unreadable.
- **Later extensions**: batch many pages (loop node) and merge into one quiz, de-duplicate questions, an OCR-first branch for dense pages.

## Phases

### Phase 0 – Scaffold

- pnpm workspace, Nuxt 3 app (`app/`), TypeScript, ESLint/Prettier, Vitest, shared tsconfig.
- `pnpm dev` runs the Nuxt app (UI + server together).

### Phase 1 – Graph engine (`packages/core`)

- Zod schemas for node defs, ports, graph JSON.
- Node registry (`registerNode`, lookup by type).
- Validation: type-compatible edges, required inputs connected, cycle detection.
- Executor: topological order, parallel branches, input resolution, caching, `AbortSignal` cancellation, event emitter (`node:start|progress|done|error`).
- Unit tests with mock nodes (the engine must be fully testable without any AI call).

### Phase 2 – Server (Nuxt Nitro, `app/server`)

- REST: workflows CRUD, node catalog (`GET /nodes`), asset upload/download, settings.
- WebSocket: `run` / `cancel` commands, streams execution events and partial outputs (e.g., streamed LLM tokens).
- SQLite tables: `workflows`, `runs`, `run_node_results`, `assets`.
- API keys stored in local encrypted settings / `.env`, never sent to browser.

### Phase 3 – Editor UI (Nuxt pages/components)

- BaklavaJS editor (`useBaklava`, `<BaklavaEditor>`): node palette (search + categories), drag/drop, type-colored ports and connection validation via `@baklavajs/interface-types` (`NodeInterfaceType`, type converters).
- Catalog-to-Baklava factory: for each catalog entry build a node with `defineNode` (inputs/outputs as `NodeInterface`s, params as built-in interfaces: `TextInterface`, `TextareaInputInterface`, `NumberInterface`, `SelectInterface`, `SliderInterface`, `CheckboxInterface`); custom Vue interfaces for image/audio/video preview and file picker.
- Converter between Baklava `editor.save()` state and AnyGen graph JSON (both directions, covered by tests).
- Inspector/preview panel: shows node output (text, image, audio/video player, JSON).
- Run controls: Run, Run selected, Cancel; per-node status (idle/running/done/error) and progress.
- Save/load/export/import workflow JSON; undo/redo; autosave.

### Phase 4 – Built-in nodes (v1)

All model nodes call the Vercel AI SDK (`generateText`/`streamText`, structured output, `generateImage`, `generateSpeech`, `transcribe`). Token deltas are forwarded to the executor's progress events; usage data from the SDK feeds the cost estimates. Video has no stable AI SDK API, so video nodes call the Replicate/fal clients directly behind the same node contract.

- **Input/utility**: Text, Number, Seed, Load Image, Template/Prompt Builder (`{{vars}}`), Concat, Switch, Loop/Batch (list map), Preview, Save File.
- **LLM**: Claude Chat, OpenAI Chat, Ollama Chat (system prompt, temperature, streaming), Structured Output (JSON schema), Vision (image + prompt).
- **Image**: OpenAI Image, Replicate/fal Image (e.g., Flux), Image-to-Image, Upscale.
- **Audio**: Text-to-Speech, Speech-to-Text.
- **Video**: Text/Image-to-Video via Replicate/fal (async job polling).
- **Generic**: HTTP Request node, Custom Code node (sandboxed JS) as escape hatch for "anything".

### Phase 5 – Extensibility

- Plugin loader: drop a folder in `plugins/` exporting node definitions; hot reload in dev.
- "Provider node generator": declarative JSON/YAML spec to wrap any REST API as a node without code.
- Subgraphs/group nodes (collapse a workflow into a reusable node).

### Phase 6 – Polish & distribution

- Run history with re-run/compare, gallery of generated assets.
- Workflow templates library.
- Cost/token estimates per run.
- Optional Electron/Tauri packaging; docs and example workflows.

## Critical Files (to be created)

- `packages/core/src/types.ts`, `graph.ts`, `registry.ts`, `executor.ts`, `validate.ts`
- `packages/nodes/src/<provider>/*.ts` (e.g., `anthropic/chat.ts`, `openai/image.ts`)
- `app/server/api/*.ts` (nodes, workflows, assets, settings), `app/server/routes/_ws.ts` (run/cancel), `app/server/utils/db.ts`, `assets.ts`
- `app/pages/index.vue`, `app/components/Editor.client.vue`, `app/composables/nodeFactory.ts` (catalog → `defineNode`), `graphConvert.ts`, `app/components/interfaces/*.vue` (media previews), `Inspector.vue`, `app/stores/run.ts`
- Risk: BaklavaJS has a smaller ecosystem than React Flow; pin the version and check its docs for the current API (v2 is Vue 3) before building the factory.

## Risks / Notes

- **Nuxt specifics**: Nitro WebSocket support is experimental (enable `nitro.experimental.websocket`); fall back to Server-Sent Events if it proves flaky. Baklava needs client-only rendering. Check whether Nuxt 4 is current and use it if so.
- **Long-running jobs** (video): use async job nodes with polling and resumable runs.
- **Binary data size**: asset references + on-disk storage avoid memory blow-ups.
- **Type system strictness vs. flexibility**: start with `any` + explicit converters; tighten later.
- **Secrets**: server-only; sandbox the Custom Code node.
- **Provider API churn**: the AI SDK absorbs most of it; keep provider-specific code in the registry and isolated node files.
- **AI SDK versions**: its structured-output and image/speech APIs have changed between majors and some are marked experimental. Pin the version, and check the docs for the installed version before writing the model nodes.
- **Server-only**: import `ai` and provider packages only under `app/server` and `packages/nodes` so keys and SDK code never reach the browser bundle. (The AI SDK's UI hooks like `useChat` are not needed; the editor talks to our own run API.)

## Verification

1. `pnpm test` – engine unit tests (topological order, cycles, type errors, caching, cancel, parallelism).
2. `pnpm dev`, open the UI, build **Load Image → Vision Structured Output → Save JSON** with a real book-page scan; confirm quiz.json is valid against the schema, contains both open and multiselect questions, and loads in the quiz runner.
   2b. Build **Text → Claude Chat → Preview**, run, confirm streamed output.
3. Build **Text → LLM (prompt enhancer) → Image Gen → Preview/Save**; confirm image appears and file lands in asset store.
4. Re-run unchanged graph → verify cache hit (nodes skipped); change one param → only downstream nodes re-run.
5. Break a node (bad API key) → only it and its dependents error; sibling branches finish.
6. Save, reload, export/import workflow JSON; round-trip equality.

## Suggested Milestones

- M1: Phases 0–2 (engine + server, CLI-runnable workflows) plus the three nodes of the first target workflow (Load Image, Vision Structured Output, Save JSON)
- M2: Phase 3 + first target workflow running end-to-end in the UI (book page → quiz.json)
- M3: Image/audio/video nodes (Phase 4)
- M4: Plugins, subgraphs, history, packaging (Phases 5–6)

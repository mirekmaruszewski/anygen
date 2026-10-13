# AnyGen – Summary for Next Chat

## Status

Phases 0–4 are implemented. Read `docs/PLAN.md` for the full plan, then the progress files for details:

- `docs/PROGRESS-PHASES-0-2.md` – scaffold, graph engine (`packages/core`), Nitro server (REST, WebSocket/SSE, SQLite, assets, secrets).
- `docs/PROGRESS-PHASE-3.md` – BaklavaJS editor UI, graph converter, run controls, inspector.
- `docs/PROGRESS-PHASE-4.md` – 27 built-in nodes (LLM, vision, quiz, image, audio, video, HTTP, sandboxed code, save/preview), `asset` file-picker param.

The first target workflow (Load Image → Quiz from Image → Save JSON) runs end to end on the built server, verified against a fake Anthropic API. It has not yet been run with a real key or a real page scan.

## What we're building

**AnyGen**: a ComfyUI-style node-graph app to generate anything with AI models. Nodes have typed inputs/outputs; users wire them on a canvas and run the graph.

## Decisions made

- **Stack**: Nuxt 4.6 (Vue 3 + Nitro), TypeScript, Pinia, pnpm workspace (`packages/core`, `packages/nodes`, `app`).
- **Editor**: BaklavaJS 2.8.1 (client-only). Baklava is the editor only.
- **Execution**: custom DAG executor on the server (`packages/core`): topological order, parallel branches, per-node caching, cancellation, progress events. API keys stay server-side.
- **Bridge**: `GET /api/nodes` serves the catalog; the app builds Baklava nodes with `defineNode`; `editor.save()` state converts to AnyGen graph JSON.
- **Model access**: Vercel AI SDK v7 on the server only. Model params are `provider:model` strings resolved by a registry built from the currently configured keys. Structured output is `generateText` + `Output.object`. Video uses the SDK's experimental video API (fal/Replicate).
- **Storage**: SQLite (`node:sqlite`) plus content-addressed files on disk; nodes pass asset references.
- **Sandbox**: the Custom Code node runs in QuickJS (WASM), not `node:vm`, because imported workflows are untrusted.

## Open items

- The quiz runner's JSON format is unknown. The format in `PLAN.md` is a placeholder; adapt `buildQuiz` and the `Quiz` type in `packages/nodes/src/quiz/quiz.ts` once the format or a sample file is available.
- Real-world checks still missing: real provider calls (especially video, fal, Replicate, Ollama) and a real book-page scan.
- Deferred nodes: Loop/Batch (needs subgraphs), Upscale.
- Model dropdown per configured provider (`GET /api/models` + UI), token usage for cost estimates.
- Nitro WebSocket is experimental; SSE fallback exists. No authentication: do not expose the server beyond localhost.

## Next steps

1. Get the quiz runner format, adapt `buildQuiz`, run the first workflow with a real key and scan.
2. Phase 5: plugin loader, declarative REST-API nodes, subgraphs (then Loop/Batch).
3. Phase 6: run history/compare, gallery, templates, cost estimates, packaging.

## Milestones

M1 engine + server + 3 nodes (done); M2 UI runs book page → quiz.json (built, needs a real-key run); M3 image/audio/video nodes (implemented, partly tested against fakes); M4 plugins, subgraphs, history, packaging.

## Notes

- The Bash tool in this environment fails on heredocs containing apostrophes; create files with the Write tool.
- `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm typecheck` (plus `npx nuxt typecheck` in `app/`).

# AnyGen – Progress: Phase 3 (Editor UI)

Status: the BaklavaJS editor is in place and verified in a real browser (Edge, headless): load a graph, run it over WebSocket, see per-node status and output, drag a node from the palette, undo, see validation errors. 65 tests pass; lint, Prettier, `pnpm typecheck`, `nuxt typecheck` (vue-tsc) and `pnpm build` are clean.

Not done: the first-workflow nodes (Load Image, Vision Structured Output, Save JSON) and therefore the file-picker / media-preview **node interfaces**; the quiz runner JSON format is still unknown.

## What was added (`app/`)

| File                            | Purpose                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `utils/graphConvert.ts`         | Baklava `editor.save()` state ⇄ AnyGen graph JSON (pure, no Baklava imports). Tested.                                                           |
| `utils/runState.ts`             | Reducer: execution events → per-node UI status/progress/outputs. Tested.                                                                        |
| `composables/nodeFactory.ts`    | Catalog → Baklava node types (`defineNode`), param widgets, port types and connection rules.                                                    |
| `composables/useNodeCatalog.ts` | Loads `GET /api/nodes` once per session.                                                                                                        |
| `composables/useWorkflowDoc.ts` | Open workflow: save/open/delete/new, import/export, dirty state, autosave (draft in localStorage; PUT to the server once a workflow has an id). |
| `stores/run.ts`                 | Pinia store: WebSocket client, run / run selected / cancel, validation issues.                                                                  |
| `components/Editor.client.vue`  | Toolbar, canvas, node status styling, hotkeys (Ctrl+S). Client-only.                                                                            |
| `components/NodePalette.vue`    | Search + categories; click or drag onto the canvas.                                                                                             |
| `components/Inspector.vue`      | Selected node's status, error and outputs (text, JSON, image/audio/video via `/api/assets/:id`).                                                |

## Design notes

- **Params vs ports.** Baklava has one `inputs` map, so params are stored under `param:<name>` and ports under their plain name. The converter relies on that prefix.
- **JSON params** are edited as text and parsed in `toGraph`; invalid JSON is passed through as a string so the server reports it.
- **Connection rules** mirror `isPortCompatible` through `@baklavajs/interface-types` conversions (`any` ⇄ everything, `list<T>` → `list<U>`). Port colors come from the `data-interface-type` attribute in a global style block in `Editor.client.vue`.
- **Run status** is written to the node elements as `data-run-status` and `--run-progress` (Baklava has no per-node status API); CSS in `Editor.client.vue` reads them.
- **Autosave** polls every 1.5 s and compares serialized graphs, because Baklava emits no event for node moves.
- **Client bundle.** `@anygen/core` index pulls in `node:crypto`; client code imports only the `@anygen/core/ports` subpath (new export) and type-only imports elsewhere.
- Packages: `@baklavajs/{core,renderer-vue,interface-types,themes}@2.8.1` (pinned) and `vue-tsc` as dev dependency; `vite.optimizeDeps.include` avoids a mid-session re-optimize.
- The built-in Baklava toolbar (copy/paste/delete/zoom) stays; its undo/redo duplicates the ones in the top bar.

## Next steps

1. Get the quiz runner JSON format; verify the AI SDK structured-output API; pin versions.
2. Implement Load Image, Vision Structured Output (Anthropic) and Save JSON in `packages/nodes`.
3. Add an `asset` param type (core) and a file-picker Baklava interface that uploads to `POST /api/assets`; add media previews inside nodes if wanted (the Inspector already previews outputs).
4. Run the first workflow end to end in the UI (M2).
